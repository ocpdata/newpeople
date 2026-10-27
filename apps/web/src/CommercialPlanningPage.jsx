import { useEffect, useRef, useState } from "react";
import { api, getApiErrorMessage } from "./api";
import {
  CommissionBulkApply,
  CommissionCategoriesCard,
  CommissionRulesCard,
  CommissionSimulator,
} from "./commercial-planning/CommissionPanels";
import CommissionTrackingView from "./commercial-planning/CommissionTrackingView";
import "./commercial-planning.css";

const TAB_OPTIONS = [
  { id: "targets", label: "Metas" },
  { id: "commissionConfigs", label: "Comisiones · Configuración" },
  { id: "sellerParameters", label: "Parámetros vendedor" },
  { id: "commissionTracking", label: "Comisiones · Seguimiento" },
];

const OPP_TO_WIN_STAGE_WEIGHTS = [
  { code: "contacto_inicial", label: "Contacto inicial", factor: 1 },
  {
    code: "identificacion_oportunidad",
    label: "Identificación de oportunidad",
    factor: 0.8,
  },
  { code: "desarrollo", label: "Desarrollo", factor: 0.6 },
  { code: "cotizacion", label: "Cotización", factor: 0.4 },
  { code: "demostracion", label: "Demostración", factor: 0.3 },
  { code: "negociacion", label: "Negociación", factor: 0.2 },
  { code: "waiting", label: "Waiting", factor: 0.1 },
];

function formatCurrency(value, currencyCode = "USD") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: currencyCode || "USD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatAmount(value) {
  return new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatPercent(value) {
  if (value === null || value === undefined || value === "") return "Sin dato";
  return `${Number(value).toFixed(2)}%`;
}

function normalizeDecimalInput(value) {
  return String(value || "")
    .replace(/,/g, "")
    .trim();
}

function formatDayValue(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) return "0";
  return Number.isInteger(numericValue)
    ? String(numericValue)
    : numericValue.toFixed(2);
}

function buildOpportunityToWinStageBreakdown(totalDays) {
  const normalizedDays = Math.max(0, Number(normalizeDecimalInput(totalDays)));
  return OPP_TO_WIN_STAGE_WEIGHTS.map((stage) => ({
    ...stage,
    days: normalizedDays * stage.factor,
  }));
}

function formatGroupedDecimalInput(value) {
  const normalized = normalizeDecimalInput(value);
  if (!normalized) return "";

  const isNegative = normalized.startsWith("-");
  const unsigned = isNegative ? normalized.slice(1) : normalized;
  const [integerPartRaw, decimalPart] = unsigned.split(".");
  const integerPart = integerPartRaw.replace(/\D/g, "") || "0";
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return `${isNegative ? "-" : ""}${groupedInteger}${
    decimalPart !== undefined ? `.${decimalPart}` : ""
  }`;
}

function formatDateTime(value) {
  if (!value) return "Sin fecha";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Sin fecha";
  return parsed.toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function withCurrentCatalogOption(options, currentValue, valueKey = "code") {
  if (!currentValue) return options;
  if (
    options.some(
      (option) => String(option?.[valueKey] || "") === String(currentValue),
    )
  ) {
    return options;
  }

  return [
    {
      id: `legacy-${valueKey}-${currentValue}`,
      [valueKey]: currentValue,
      name: currentValue,
    },
    ...options,
  ];
}

function mergeTargetDrafts(periodDetail) {
  if (!periodDetail) return [];
  const targetsBySellerId = new Map(
    (periodDetail.targets || []).map((target) => [
      target.sellerUserId,
      target,
    ]),
  );

  return (periodDetail.eligibleSellers || []).map((seller) => {
    const target = targetsBySellerId.get(seller.id);
    return {
      sellerUserId: seller.id,
      sellerUserName: seller.fullName,
      sellerEmail: seller.email,
      targetId: target?.id || null,
      salesQuotaAmount:
        target?.salesQuotaAmount === null ||
        target?.salesQuotaAmount === undefined
          ? ""
          : String(target.salesQuotaAmount),
      currencyCode:
        target?.currencyCode || periodDetail.period.baseCurrencyCode || "USD",
      expectedMarginPercent:
        target?.expectedMarginPercent === null ||
        target?.expectedMarginPercent === undefined
          ? ""
          : String(target.expectedMarginPercent),
      expectedContributionAmount: target?.expectedContributionAmount || 0,
      notes: target?.notes || "",
      status: target?.status || "complete",
      updatedByUserName: target?.updatedByUserName || "",
      updatedAt: target?.updatedAt || null,
    };
  });
}

function mergeAnnualTargetDrafts(plan) {
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

function buildAnnualTargetPayload(quarterDrafts) {
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

function mergeCommissionConfigDrafts(payload) {
  return (payload?.quarters || []).map((quarter) => ({
    quarter: quarter.quarter,
    period: quarter.period,
    sellers: (quarter.sellers || []).map((seller) => ({
      sellerUserId: seller.sellerUserId,
      sellerUserName: seller.sellerUserName,
      sellerUserEmail: seller.sellerUserEmail,
      salesQuotaAmount: seller.salesQuotaAmount || 0,
      productCommissionPct: String(seller.productCommissionPct ?? 0),
      serviceCommissionPct: String(seller.serviceCommissionPct ?? 0),
      renewalCommissionPct: String(seller.renewalCommissionPct ?? 0),
    })),
  }));
}

function buildAnnualCommissionConfigPayload(quarterDrafts) {
  const errors = [];
  const quarters = (quarterDrafts || []).map((quarter) => ({
    quarter: quarter.quarter,
    configs: quarter.sellers.map((seller) => {
      const rates = [
        Number(normalizeDecimalInput(seller.productCommissionPct)),
        Number(normalizeDecimalInput(seller.serviceCommissionPct)),
        Number(normalizeDecimalInput(seller.renewalCommissionPct)),
      ];
      if (rates.some((rate) => !Number.isFinite(rate) || rate < 0 || rate > 100)) {
        errors.push(`Los porcentajes de comisión de ${seller.sellerUserName} en T${quarter.quarter} deben estar entre 0 y 100.`);
      }
      return {
        sellerUserId: seller.sellerUserId,
        productCommissionPct: rates[0],
        serviceCommissionPct: rates[1],
        renewalCommissionPct: rates[2],
      };
    }),
  }));
  return { quarters, errors };
}

function mergeSellerParameterDrafts(payload) {
  return (payload?.sellers || []).map((seller) => ({
    sellerUserId: seller.sellerUserId,
    sellerUserName: seller.sellerUserName,
    sellerUserEmail: seller.sellerUserEmail,
    averageSaleTicketAmount: String(seller.averageSaleTicketAmount ?? 0),
    leadsToOpportunitiesRatio: String(seller.leadsToOpportunitiesRatio ?? 0),
    opportunitiesToWinsRatio: String(seller.opportunitiesToWinsRatio ?? 0),
    averageOpportunityToWinDays: String(
      seller.averageOpportunityToWinDays ?? 0,
    ),
    useHistoricalAverageSaleTicketForQuotaProbability:
      seller.useHistoricalAverageSaleTicketForQuotaProbability === true,
    useHistoricalLeadsToOpportunitiesForQuotaProbability:
      seller.useHistoricalLeadsToOpportunitiesForQuotaProbability === true,
    useHistoricalOpportunitiesToWinsForQuotaProbability:
      seller.useHistoricalOpportunitiesToWinsForQuotaProbability === true,
    useHistoricalAverageOpportunityToWinDaysForQuotaProbability:
      seller.useHistoricalAverageOpportunityToWinDaysForQuotaProbability ===
      true,
    updatedAt: seller.updatedAt || null,
    updatedByUserName: seller.updatedByUserName || "",
  }));
}

function buildSellerParameterPayload(parameterDrafts) {
  const errors = [];
  const parameters = (parameterDrafts || []).map((draft) => {
    const averageSaleTicketAmount = Number(
      normalizeDecimalInput(draft.averageSaleTicketAmount),
    );
    const leadsToOpportunitiesRatio = Number(
      normalizeDecimalInput(draft.leadsToOpportunitiesRatio),
    );
    const opportunitiesToWinsRatio = Number(
      normalizeDecimalInput(draft.opportunitiesToWinsRatio),
    );
    const averageOpportunityToWinDays = Number(
      normalizeDecimalInput(draft.averageOpportunityToWinDays),
    );

    if (
      Number.isNaN(averageSaleTicketAmount) ||
      averageSaleTicketAmount < 0 ||
      Number.isNaN(leadsToOpportunitiesRatio) ||
      leadsToOpportunitiesRatio < 0 ||
      Number.isNaN(opportunitiesToWinsRatio) ||
      opportunitiesToWinsRatio < 0 ||
      Number.isNaN(averageOpportunityToWinDays) ||
      averageOpportunityToWinDays < 0
    ) {
      errors.push(
        `Los parámetros de ${draft.sellerUserName} deben ser numéricos y mayores o iguales a cero.`,
      );
    }

    return {
      sellerUserId: draft.sellerUserId,
      averageSaleTicketAmount: Number.isNaN(averageSaleTicketAmount)
        ? 0
        : averageSaleTicketAmount,
      leadsToOpportunitiesRatio: Number.isNaN(leadsToOpportunitiesRatio)
        ? 0
        : leadsToOpportunitiesRatio,
      opportunitiesToWinsRatio: Number.isNaN(opportunitiesToWinsRatio)
        ? 0
        : opportunitiesToWinsRatio,
      averageOpportunityToWinDays: Number.isNaN(averageOpportunityToWinDays)
        ? 0
        : averageOpportunityToWinDays,
      useHistoricalAverageSaleTicketForQuotaProbability:
        draft.useHistoricalAverageSaleTicketForQuotaProbability === true,
      useHistoricalLeadsToOpportunitiesForQuotaProbability:
        draft.useHistoricalLeadsToOpportunitiesForQuotaProbability === true,
      useHistoricalOpportunitiesToWinsForQuotaProbability:
        draft.useHistoricalOpportunitiesToWinsForQuotaProbability === true,
      useHistoricalAverageOpportunityToWinDaysForQuotaProbability:
        draft.useHistoricalAverageOpportunityToWinDaysForQuotaProbability ===
        true,
    };
  });

  return { parameters, errors };
}

export default function CommercialPlanningPage({ can }) {
  const [activeTab, setActiveTab] = useState("targets");
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [periods, setPeriods] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [planningYear, setPlanningYear] = useState(() => new Date().getFullYear());
  const [annualPlan, setAnnualPlan] = useState(null);
  const [annualTargetDrafts, setAnnualTargetDrafts] = useState([]);
  const [annualCurrencyCode, setAnnualCurrencyCode] = useState("USD");
  const [loadingAnnualPlan, setLoadingAnnualPlan] = useState(false);
  const [selectedPeriodId, setSelectedPeriodId] = useState(null);
  const [periodDetail, setPeriodDetail] = useState(null);
  const [targetDrafts, setTargetDrafts] = useState([]);
  const [auditEntries, setAuditEntries] = useState([]);
  const [commissionConfigYear, setCommissionConfigYear] = useState(() => new Date().getFullYear());
  const [commissionConfigDrafts, setCommissionConfigDrafts] = useState([]);
  const [commissionConfigMeta, setCommissionConfigMeta] = useState(null);
  const [commissionTrackingYear, setCommissionTrackingYear] = useState(() => new Date().getFullYear());
  const [commissionTracking, setCommissionTracking] = useState(null);
  const [loadingCommissionConfigs, setLoadingCommissionConfigs] =
    useState(false);
  const [loadingCommissionTracking, setLoadingCommissionTracking] =
    useState(false);
  const [savingCommissionConfigs, setSavingCommissionConfigs] = useState(false);
  const [sellerParameterDrafts, setSellerParameterDrafts] = useState([]);
  const [sellerParameterMeta, setSellerParameterMeta] = useState(null);
  const [loadingSellerParameters, setLoadingSellerParameters] = useState(false);
  const [savingSellerParameters, setSavingSellerParameters] = useState(false);
  const [savingAnnualTargets, setSavingAnnualTargets] = useState(false);
  const helpPopoverRef = useRef(null);

  const canCreate = can("planeacion_comercial.create");
  const canUpdate = can("planeacion_comercial.update");
  const canReadAudit = can("planeacion_comercial.audit.read");

  async function loadPlanningYear(year) {
    setLoadingAnnualPlan(true);
    setAnnualPlan(null);
    setAnnualTargetDrafts([]);
    try {
      const response = await api.get(`/api/commercial-planning/years/${year}`);
      setAnnualPlan(response.data);
      setAnnualCurrencyCode(response.data.currencyCode || "USD");
      setAnnualTargetDrafts(mergeAnnualTargetDrafts(response.data));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No fue posible cargar las metas del año"));
    } finally {
      setLoadingAnnualPlan(false);
    }
  }

  async function selectPeriod(periodId) {
    if (!periodId) {
      setSelectedPeriodId(null);
      setPeriodDetail(null);
      setTargetDrafts([]);
      return;
    }

    const periodResponse = await api.get(
      `/api/commercial-planning/periods/${periodId}`,
    );
    const nextPeriodDetail = periodResponse.data;
    setSelectedPeriodId(periodId);
    setPeriodDetail(nextPeriodDetail);
    setTargetDrafts(mergeTargetDrafts(nextPeriodDetail));
  }

  async function loadPeriods(preferredPeriodId = null) {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/api/commercial-planning/periods");
      const nextPeriods = response.data.periods || [];
      setPeriods(nextPeriods);

      const nextPeriodId =
        preferredPeriodId || selectedPeriodId || nextPeriods[0]?.id || null;

      if (!nextPeriodId) {
        await selectPeriod(null);
        return;
      }

      await selectPeriod(nextPeriodId);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar la planeación comercial",
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadCurrencies() {
    try {
      const response = await api.get("/api/catalogs/currencies");
      setCurrencies(response.data || []);
    } catch {
      setCurrencies([]);
    }
  }

  async function loadAudit() {
    if (!canReadAudit || !periodDetail?.period) return;
    try {
      const response = await api.get("/api/commercial-planning/audit", {
        params: {
          year: periodDetail.period.year,
          quarter: periodDetail.period.quarter,
        },
      });
      setAuditEntries(response.data.entries || []);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar la auditoría de planeación comercial",
        ),
      );
    }
  }

  async function loadCommissionConfigs(year = commissionConfigYear) {
    setLoadingCommissionConfigs(true);
    setCommissionConfigMeta(null);
    setCommissionConfigDrafts([]);
    try {
      const response = await api.get(
        `/api/commercial-planning/years/${year}/commission-configs`,
      );
      setCommissionConfigMeta(response.data);
      setCommissionConfigDrafts(mergeCommissionConfigDrafts(response.data));
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar la configuración de comisiones",
        ),
      );
    } finally {
      setLoadingCommissionConfigs(false);
    }
  }

  async function loadCommissionTracking(year = commissionTrackingYear) {
    setLoadingCommissionTracking(true);
    setCommissionTracking(null);
    try {
      const planResponse = await api.get(`/api/commercial-planning/years/${year}`);
      const plan = planResponse.data;
      const quarters = await Promise.all(plan.quarters.map(async (quarter) => {
        if (quarter.period.id) {
          const response = await api.get(
            `/api/commercial-planning/periods/${quarter.period.id}/commission-tracking`,
          );
          return { quarter: quarter.quarter, tracking: response.data };
        }
        const targetsBySellerId = new Map(
          quarter.targets.map((target) => [target.sellerUserId, target]),
        );
        return {
          quarter: quarter.quarter,
          tracking: {
            period: quarter.period,
            baseCurrencyCode: plan.currencyCode,
            pendingQuotations: [],
            summaries: plan.eligibleSellers.map((seller) => {
              const target = targetsBySellerId.get(seller.id);
              return {
                sellerUserId: seller.id,
                sellerUserName: seller.fullName,
                sellerUserEmail: seller.email,
                currencyCode: plan.currencyCode,
                salesQuotaAmount: target?.salesQuotaAmount || 0,
                acceptedSalesAmount: 0,
                quotaAttainmentPct: 0,
                commissionEnabled: false,
                eligibleQuotationCount: 0,
                blockedLowMarginQuotationCount: 0,
                eligibleProductContributionAmount: 0,
                eligibleServiceContributionAmount: 0,
                eligibleRenewalContributionAmount: 0,
                calculatedTotalCommissionAmount: 0,
                quotations: [],
              };
            }),
          },
        };
      }));
      setCommissionTracking(quarters);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar el seguimiento de comisiones",
        ),
      );
    } finally {
      setLoadingCommissionTracking(false);
    }
  }

  async function loadSellerParameters() {
    setLoadingSellerParameters(true);
    try {
      const response = await api.get(
        "/api/commercial-planning/seller-parameters",
      );
      setSellerParameterMeta(response.data);
      setSellerParameterDrafts(mergeSellerParameterDrafts(response.data));
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar los parámetros de vendedor",
        ),
      );
    } finally {
      setLoadingSellerParameters(false);
    }
  }

  useEffect(() => {
    // Initial page bootstrap intentionally triggers these data loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPeriods();
    loadCurrencies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPlanningYear(planningYear);
  }, [planningYear]);

  useEffect(() => {
    if (activeTab === "audit") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadAudit();
    }
    if (activeTab === "sellerParameters") {
      loadSellerParameters();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, periodDetail?.period?.id]);

  useEffect(() => {
    if (activeTab !== "commissionTracking") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCommissionTracking(commissionTrackingYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, commissionTrackingYear]);

  useEffect(() => {
    if (activeTab !== "commissionConfigs") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCommissionConfigs(commissionConfigYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, commissionConfigYear]);

  useEffect(() => {
    if (!isHelpOpen) return undefined;

    function handlePointerDown(event) {
      if (!helpPopoverRef.current?.contains(event.target)) {
        setIsHelpOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsHelpOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isHelpOpen]);

  function updateAnnualTargetDraft(quarter, sellerUserId, field, value) {
    setAnnualTargetDrafts((current) => current.map((item) => item.quarter !== quarter
      ? item
      : {
          ...item,
          sellers: item.sellers.map((seller) => seller.sellerUserId === sellerUserId
            ? { ...seller, [field]: value }
            : seller),
        }));
  }

  function updateCommissionConfigDraft(quarter, sellerUserId, field, value) {
    setCommissionConfigDrafts((current) => current.map((item) => item.quarter !== quarter
      ? item
      : {
          ...item,
          sellers: item.sellers.map((seller) => seller.sellerUserId === sellerUserId
            ? { ...seller, [field]: value }
            : seller),
        }));
  }

  function applyCommissionRatesToQuarter(quarter, values) {
    const fields = {
      products: "productCommissionPct",
      services: "serviceCommissionPct",
      renewals: "renewalCommissionPct",
    };
    setCommissionConfigDrafts((current) => current.map((item) => item.quarter !== quarter
      ? item
      : {
          ...item,
          sellers: item.sellers.map((seller) => {
            const next = { ...seller };
            Object.entries(fields).forEach(([key, field]) => {
              if (values[key] !== "" && values[key] !== undefined) next[field] = values[key];
            });
            return next;
          }),
        }));
  }

  function copyCommissionRatesFromPreviousQuarter(quarter) {
    setCommissionConfigDrafts((current) => {
      const previous = current.find((item) => item.quarter === quarter - 1);
      if (!previous) return current;
      const previousBySeller = new Map(previous.sellers.map((seller) => [seller.sellerUserId, seller]));
      return current.map((item) => item.quarter !== quarter
        ? item
        : {
            ...item,
            sellers: item.sellers.map((seller) => {
              const source = previousBySeller.get(seller.sellerUserId);
              return source
                ? {
                    ...seller,
                    productCommissionPct: source.productCommissionPct,
                    serviceCommissionPct: source.serviceCommissionPct,
                    renewalCommissionPct: source.renewalCommissionPct,
                  }
                : seller;
            }),
          });
    });
  }

  function updateSellerParameterDraft(sellerUserId, field, value) {
    setSellerParameterDrafts((current) =>
      current.map((item) =>
        item.sellerUserId === sellerUserId ? { ...item, [field]: value } : item,
      ),
    );
  }

  async function handleSaveAnnualTargets() {
    if (!annualPlan || !canEditAnnualTargets) return;
    const payload = buildAnnualTargetPayload(annualTargetDrafts);
    if (payload.errors.length) {
      setError(payload.errors[0]);
      return;
    }

    setSavingAnnualTargets(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.put(`/api/commercial-planning/years/${planningYear}/targets`, {
        currencyCode: annualCurrencyCode,
        quarters: payload.quarters,
      });
      setSuccess(response.data.message);
      await loadPeriods(selectedPeriodId);
      await loadPlanningYear(planningYear);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible guardar las metas trimestrales",
        ),
      );
    } finally {
      setSavingAnnualTargets(false);
    }
  }

  async function handleSaveCommissionConfigs() {
    if (!commissionConfigDrafts.length || !canEditCommissionConfigs) return;
    const payload = buildAnnualCommissionConfigPayload(commissionConfigDrafts);
    if (payload.errors.length) {
      setError(payload.errors[0]);
      return;
    }

    setSavingCommissionConfigs(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.put(
        `/api/commercial-planning/years/${commissionConfigYear}/commission-configs`,
        payload,
      );
      setSuccess(response.data.message);
      setCommissionConfigMeta(response.data);
      setCommissionConfigDrafts(mergeCommissionConfigDrafts(response.data));
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible guardar la configuración de comisiones",
        ),
      );
    } finally {
      setSavingCommissionConfigs(false);
    }
  }

  async function handleSaveSellerParameters() {
    const payload = buildSellerParameterPayload(sellerParameterDrafts);
    if (payload.errors.length) {
      setError(payload.errors[0]);
      return;
    }

    setSavingSellerParameters(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.put(
        "/api/commercial-planning/seller-parameters",
        payload,
      );
      setSuccess(response.data.message);
      setSellerParameterMeta(response.data);
      setSellerParameterDrafts(mergeSellerParameterDrafts(response.data));
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible guardar los parámetros de vendedor",
        ),
      );
    } finally {
      setSavingSellerParameters(false);
    }
  }

  if (loading) {
    return (
      <section className="panel centered">
        Cargando planeación comercial...
      </section>
    );
  }

  const summary = periodDetail?.period || null;
  const eligibleSellerCount = periodDetail?.eligibleSellers?.length || 0;
  const filledTargetsCount = targetDrafts.filter(
    (item) =>
      String(item.salesQuotaAmount).trim() &&
      String(item.expectedMarginPercent).trim(),
  ).length;
  const pendingTargetsCount = Math.max(
    eligibleSellerCount - filledTargetsCount,
    0,
  );
  const activeYear = periodDetail?.period?.year || null;
  const yearlyPeriods = activeYear
    ? periods
        .filter((period) => period.year === activeYear)
        .sort((left, right) => left.quarter - right.quarter)
    : [];
  const yearlyQuotaTotal = yearlyPeriods.reduce(
    (total, period) => total + Number(period.totalQuotaAmount || 0),
    0,
  );
  const yearlyContributionTotal = yearlyPeriods.reduce(
    (total, period) => total + Number(period.totalContributionAmount || 0),
    0,
  );
  const yearlyMarginAverage = yearlyQuotaTotal
    ? (yearlyContributionTotal / yearlyQuotaTotal) * 100
    : null;
  const annualQuotaBySellerId = new Map();
  for (const quarter of annualTargetDrafts) {
    for (const seller of quarter.sellers) {
      const summary = annualQuotaBySellerId.get(seller.sellerUserId) || {
        sellerUserId: seller.sellerUserId,
        sellerUserName: seller.sellerUserName,
        sellerEmail: seller.sellerEmail,
        salesQuotaAmount: 0,
        quarterlyQuotaAmounts: { 1: 0, 2: 0, 3: 0, 4: 0 },
        expectedContributionAmount: 0,
      };
      const salesQuotaAmount = Number(
        normalizeDecimalInput(seller.salesQuotaAmount) || 0,
      );
      const expectedMarginPercent = Number(seller.expectedMarginPercent || 0);
      summary.quarterlyQuotaAmounts[quarter.quarter] = salesQuotaAmount;
      summary.salesQuotaAmount += salesQuotaAmount;
      summary.expectedContributionAmount += salesQuotaAmount * expectedMarginPercent / 100;
      annualQuotaBySellerId.set(seller.sellerUserId, summary);
    }
  }
  const annualQuotaSummary = [...annualQuotaBySellerId.values()].sort(
    (left, right) => left.sellerUserName.localeCompare(right.sellerUserName, "es"),
  );
  const annualQuotaTotal = annualQuotaSummary.reduce(
    (total, seller) => total + seller.salesQuotaAmount,
    0,
  );
  const annualContributionTotal = annualQuotaSummary.reduce(
    (total, seller) => total + seller.expectedContributionAmount,
    0,
  );
  const quarterlyQuotaTotals = [1, 2, 3, 4].map((quarter) =>
    annualQuotaSummary.reduce(
      (total, seller) => total + seller.quarterlyQuotaAmounts[quarter],
      0,
    ),
  );
  const canEditAnnualTargets = Boolean(
    annualPlan &&
    (annualPlan.hasPersistedPeriods ? canUpdate : canCreate),
  );
  const canEditCommissionConfigs = Boolean(
    commissionConfigMeta &&
    (commissionConfigMeta.hasPersistedPeriods ? canUpdate : canCreate),
  );

  return (
    <section className="panel commercial-planning-page">
      <header className="commercial-planning-header">
        <div className="commercial-planning-header-copy">
          <div className="commercial-planning-title-row">
            <div className="module-title-with-icon">
              <h2>Planeación Comercial</h2>
              <span
                className="module-title-icon commercial-planning-title-icon"
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M4 19h16" />
                  <path d="M7 16V9" />
                  <path d="M12 16V5" />
                  <path d="M17 16v-4" />
                </svg>
              </span>
            </div>
            <div className="commercial-planning-help" ref={helpPopoverRef}>
              <button
                type="button"
                className="commercial-planning-help-trigger"
                aria-label="Información sobre el módulo de planeación comercial"
                aria-expanded={isHelpOpen}
                onClick={() => setIsHelpOpen((current) => !current)}
              >
                ?
              </button>
              {isHelpOpen ? (
                <div
                  className="commercial-planning-help-popover"
                  role="dialog"
                  aria-label="Ayuda de planeación comercial"
                >
                  <strong>Para qué sirve este módulo</strong>
                  <p>
                    Define las metas anuales, organizadas en cuatro trimestres.
                  </p>
                  <strong>Cómo usarlo</strong>
                  <ol className="commercial-planning-help-list">
                    <li>Selecciona el año de planeación.</li>
                    <li>Captura cuota y margen para cada trimestre.</li>
                    <li>Guarda una vez para aplicar los cambios abiertos.</li>
                  </ol>
                </div>
              ) : null}
            </div>
          </div>
          <p className="roles-subtitle commercial-planning-subtitle">
            Define metas trimestrales de cuota de venta, margen esperado y
            contribución esperada por vendedor.
          </p>
        </div>
      </header>

      {error ? <div className="form-error">{error}</div> : null}
      {success ? <div className="form-success">{success}</div> : null}

      <div
        className="commercial-planning-tabs"
        role="tablist"
        aria-label="Vistas de planeación comercial"
      >
        {TAB_OPTIONS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`commercial-planning-tab ${activeTab === tab.id ? "is-active" : ""}`.trim()}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "summary" ? (
        <div className="commercial-planning-section-stack">
          <div className="commercial-planning-overview-grid">
            <section className="commercial-planning-hero-card">
              <div className="commercial-planning-hero-topline">
                <div className="commercial-planning-hero-title-group">
                  <span className="commercial-planning-eyebrow">
                    Período seleccionado
                  </span>
                  <h3>{summary?.label || "Selecciona un período"}</h3>
                </div>
                <div className="commercial-planning-context-pills">
                  {summary?.baseCurrencyCode ? (
                    <span className="commercial-planning-status-pill">
                      {summary.baseCurrencyCode}
                    </span>
                  ) : null}
                  <span
                    className={`commercial-planning-status-pill commercial-planning-target-pill ${pendingTargetsCount ? "is-warn" : ""}`.trim()}
                    data-tooltip={
                      pendingTargetsCount
                        ? `${pendingTargetsCount} vendedores activos aún no tienen meta completa en este período.`
                        : "Todos los vendedores activos ya tienen meta completa en este período."
                    }
                  >
                    Metas {filledTargetsCount}/{eligibleSellerCount || 0}
                  </span>
                </div>
              </div>
              <div className="commercial-planning-hero-metrics">
                <div>
                  <span>Cuota total</span>
                  <strong>
                    {formatCurrency(
                      summary?.totalQuotaAmount || 0,
                      summary?.baseCurrencyCode || "USD",
                    )}
                  </strong>
                </div>
                <div>
                  <span>Margen esperado promedio</span>
                  <strong>
                    {formatPercent(summary?.expectedMarginAveragePercent || 0)}
                  </strong>
                </div>
                <div>
                  <span>Contribucion esperada</span>
                  <strong>
                    {formatCurrency(
                      summary?.totalContributionAmount || 0,
                      summary?.baseCurrencyCode || "USD",
                    )}
                  </strong>
                </div>
              </div>

              <div className="commercial-planning-seller-summary">
                <div className="commercial-planning-seller-summary-header">
                  <h4>Detalle por vendedor</h4>
                  <p>
                    Cuota, margen esperado y contribución estimada del período.
                  </p>
                </div>

                <div className="commercial-planning-seller-summary-table-wrap">
                  <table className="commercial-planning-seller-summary-table">
                    <thead>
                      <tr>
                        <th>Vendedor</th>
                        <th>Cuota</th>
                        <th>Margen</th>
                        <th>Contribucion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {targetDrafts.map((item) => {
                        const contribution =
                          Number(item.salesQuotaAmount || 0) *
                          (Number(item.expectedMarginPercent || 0) / 100);

                        return (
                          <tr key={`summary-${item.sellerUserId}`}>
                            <td>
                              <strong>{item.sellerUserName}</strong>
                            </td>
                            <td>
                              {formatCurrency(
                                item.salesQuotaAmount || 0,
                                item.currencyCode ||
                                  summary?.baseCurrencyCode ||
                                  "USD",
                              )}
                            </td>
                            <td>
                              {formatPercent(item.expectedMarginPercent || 0)}
                            </td>
                            <td>
                              {formatCurrency(
                                contribution,
                                item.currencyCode ||
                                  summary?.baseCurrencyCode ||
                                  "USD",
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </div>

          {yearlyPeriods.length ? (
            <section className="commercial-planning-card">
              <div className="commercial-planning-card-header">
                <div>
                  <h3>Resumen anual {activeYear}</h3>
                  <p>
                    Totales por trimestre del año activo y consolidado anual.
                  </p>
                </div>
              </div>

              <div className="commercial-planning-seller-summary-table-wrap">
                <table className="commercial-planning-seller-summary-table commercial-planning-year-summary-table">
                  <thead>
                    <tr>
                      <th>Periodo</th>
                      <th>Cuota total</th>
                      <th>Margen</th>
                      <th>Contribucion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearlyPeriods.map((period) => (
                      <tr key={`year-summary-${period.id}`}>
                        <td>
                          <strong>{period.label}</strong>
                        </td>
                        <td>
                          {formatCurrency(
                            period.totalQuotaAmount,
                            period.baseCurrencyCode ||
                              summary?.baseCurrencyCode ||
                              "USD",
                          )}
                        </td>
                        <td>
                          {formatPercent(period.expectedMarginAveragePercent)}
                        </td>
                        <td>
                          {formatCurrency(
                            period.totalContributionAmount,
                            period.baseCurrencyCode ||
                              summary?.baseCurrencyCode ||
                              "USD",
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr className="commercial-planning-year-summary-total-row">
                      <td>
                        <strong>Total anual {activeYear} · {yearlyPeriods.length} trimestres</strong>
                      </td>
                      <td>
                        <strong>
                          {formatCurrency(
                            yearlyQuotaTotal,
                            summary?.baseCurrencyCode ||
                              yearlyPeriods[0]?.baseCurrencyCode ||
                              "USD",
                          )}
                        </strong>
                      </td>
                      <td>
                        <strong>{formatPercent(yearlyMarginAverage)}</strong>
                      </td>
                      <td>
                        <strong>
                          {formatCurrency(
                            yearlyContributionTotal,
                            summary?.baseCurrencyCode ||
                              yearlyPeriods[0]?.baseCurrencyCode ||
                              "USD",
                          )}
                        </strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

        </div>
      ) : null}

      {activeTab === "targets" ? (
        <div className="commercial-planning-annual">
          <header className="commercial-planning-annual-header">
            <div>
              <h3>Metas anuales</h3>
              <p>Los cambios de los trimestres abiertos quedan vigentes al guardar.</p>
            </div>
            <div className="commercial-planning-annual-controls">
              <label>
                Año
                <select
                  aria-label="Año de metas"
                  value={planningYear}
                  onChange={(event) => {
                    setError("");
                    setPlanningYear(Number(event.target.value));
                  }}
                >
                  {Array.from({ length: 81 }, (_, index) => 2020 + index).map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </label>
              <label>
                Moneda anual
                <select
                  aria-label="Moneda anual"
                  value={annualCurrencyCode}
                  onChange={(event) => setAnnualCurrencyCode(event.target.value)}
                  disabled={!canEditAnnualTargets || savingAnnualTargets}
                >
                  {withCurrentCatalogOption(currencies, annualCurrencyCode).map((currency) => (
                    <option key={currency.id || currency.code} value={currency.code}>
                      {currency.code}{currency.name ? ` - ${currency.name}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              {canCreate || canUpdate ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSaveAnnualTargets}
                  disabled={savingAnnualTargets || !canEditAnnualTargets || loadingAnnualPlan}
                >
                  {savingAnnualTargets ? "Guardando..." : "Guardar metas"}
                </button>
              ) : null}
            </div>
          </header>

          {loadingAnnualPlan ? (
            <div className="field-hint">Cargando metas de {planningYear}...</div>
          ) : (
            <div className="commercial-planning-quarter-grid">
              {annualTargetDrafts.map((quarter) => {
                const totals = quarter.sellers.reduce((result, seller) => {
                  const quota = Number(normalizeDecimalInput(seller.salesQuotaAmount) || 0);
                  const margin = Number(seller.expectedMarginPercent || 0);
                  const contribution = quota * margin / 100;
                  result.quota += quota;
                  result.contribution += contribution;
                  return result;
                }, { quota: 0, contribution: 0 });
                const marginAverage = totals.quota ? totals.contribution / totals.quota * 100 : null;
                return (
                  <section className="commercial-planning-quarter-panel" key={quarter.quarter}>
                    <div className="commercial-planning-quarter-header">
                      <h4>T{quarter.quarter} {planningYear}</h4>
                    </div>
                    <div className="commercial-planning-table-wrap">
                      <table className="commercial-planning-table commercial-planning-annual-target-table">
                        <thead>
                          <tr>
                            <th>Vendedor</th>
                            <th>Cuota</th>
                            <th>Margen esperado</th>
                            <th>Contribución esperada</th>
                          </tr>
                        </thead>
                        <tbody>
                          {quarter.sellers.map((seller) => {
                            const quota = Number(normalizeDecimalInput(seller.salesQuotaAmount) || 0);
                            const margin = Number(seller.expectedMarginPercent || 0);
                            return (
                              <tr key={seller.sellerUserId}>
                                <td>
                                  <strong>{seller.sellerUserName}</strong>
                                  <div className="field-hint">{seller.sellerEmail}</div>
                                </td>
                                <td>
                                  <input
                                    aria-label={`Cuota ${seller.sellerUserName} T${quarter.quarter}`}
                                    type="text"
                                    inputMode="decimal"
                                    value={formatGroupedDecimalInput(seller.salesQuotaAmount)}
                                    onChange={(event) => updateAnnualTargetDraft(
                                      quarter.quarter,
                                      seller.sellerUserId,
                                      "salesQuotaAmount",
                                      normalizeDecimalInput(event.target.value),
                                    )}
                                    disabled={!canEditAnnualTargets || savingAnnualTargets}
                                  />
                                </td>
                                <td>
                                  <input
                                    aria-label={`Margen ${seller.sellerUserName} T${quarter.quarter}`}
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={seller.expectedMarginPercent}
                                    onChange={(event) => updateAnnualTargetDraft(
                                      quarter.quarter,
                                      seller.sellerUserId,
                                      "expectedMarginPercent",
                                      event.target.value,
                                    )}
                                    disabled={!canEditAnnualTargets || savingAnnualTargets}
                                  />
                                </td>
                                <td>{formatAmount(quota * margin / 100)}</td>
                              </tr>
                            );
                          })}
                          {!quarter.sellers.length ? (
                            <tr><td colSpan="4" className="centered">No hay vendedores elegibles.</td></tr>
                          ) : null}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td><strong>Total T{quarter.quarter}</strong></td>
                            <td><strong>{formatAmount(totals.quota)}</strong></td>
                            <td><strong>{formatPercent(marginAverage)}</strong></td>
                            <td><strong>{formatAmount(totals.contribution)}</strong></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </section>
                );
              })}
            </div>
          )}
          {!loadingAnnualPlan && annualQuotaSummary.length ? (
            <section className="commercial-planning-annual-quota-summary">
              <h4>Cuota anual por vendedor</h4>
              <div className="commercial-planning-table-wrap">
                <table className="commercial-planning-table commercial-planning-annual-quota-summary-table">
                  <thead>
                    <tr>
                      <th>Vendedor</th>
                      <th>T1</th>
                      <th>T2</th>
                      <th>T3</th>
                      <th>T4</th>
                      <th>Cuota anual</th>
                      <th>Contribución anual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {annualQuotaSummary.map((seller) => (
                      <tr key={`annual-quota-${seller.sellerUserId}`}>
                        <td>
                          <strong>{seller.sellerUserName}</strong>
                          {seller.sellerEmail ? (
                            <div className="field-hint">{seller.sellerEmail}</div>
                          ) : null}
                        </td>
                        {[1, 2, 3, 4].map((quarter) => (
                          <td className="is-numeric" key={`seller-${seller.sellerUserId}-q${quarter}`}>
                            {formatAmount(seller.quarterlyQuotaAmounts[quarter])}
                          </td>
                        ))}
                        <td className="is-numeric">
                          {formatAmount(seller.salesQuotaAmount)}
                        </td>
                        <td className="is-numeric">
                          {formatAmount(seller.expectedContributionAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td><strong>Total anual</strong></td>
                      {quarterlyQuotaTotals.map((total, index) => (
                        <td className="is-numeric" key={`annual-quota-total-q${index + 1}`}>
                          <strong>{formatAmount(total)}</strong>
                        </td>
                      ))}
                      <td className="is-numeric"><strong>{formatAmount(annualQuotaTotal)}</strong></td>
                      <td className="is-numeric"><strong>{formatAmount(annualContributionTotal)}</strong></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {activeTab === "commissionConfigs" ? (
        <div className="commercial-planning-annual">
          <header className="commercial-planning-annual-header">
            <div>
              <h3>Configuración anual de comisiones</h3>
              <p>
                Define los porcentajes de productos, servicios y renovaciones por vendedor y trimestre.
                Las cuotas se toman de{" "}
                <button type="button" className="commission-link-button" onClick={() => setActiveTab("targets")}>
                  Metas
                </button>
                {" "}(versión activa).
              </p>
            </div>
            <div className="commercial-planning-annual-controls">
              <label>
                Año
                <select
                  aria-label="Año de comisiones"
                  value={commissionConfigYear}
                  onChange={(event) => setCommissionConfigYear(Number(event.target.value))}
                >
                  {Array.from({ length: 81 }, (_, index) => 2020 + index).map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </label>
              {canCreate || canUpdate ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSaveCommissionConfigs}
                  disabled={savingCommissionConfigs || loadingCommissionConfigs || !commissionConfigDrafts.length || !canEditCommissionConfigs}
                >
                  {savingCommissionConfigs ? "Guardando..." : "Guardar configuración"}
                </button>
              ) : null}
            </div>
          </header>

          {loadingCommissionConfigs ? (
            <div className="field-hint">Cargando configuración de comisiones...</div>
          ) : (
            <>
            <CommissionRulesCard />
            <CommissionCategoriesCard />
            <CommissionSimulator quarters={commissionConfigDrafts} year={commissionConfigYear} />
            <div className="commercial-planning-quarter-grid commercial-planning-commission-grid">
              {commissionConfigDrafts.map((quarter) => {
                const totalQuota = quarter.sellers.reduce(
                  (total, seller) => total + Number(seller.salesQuotaAmount || 0),
                  0,
                );
                return (
                <section className="commercial-planning-quarter-panel" key={quarter.quarter}>
                  <div className="commercial-planning-quarter-header">
                    <h4>T{quarter.quarter} {commissionConfigYear}</h4>
                    {quarter.quarter > 1 && canEditCommissionConfigs ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={savingCommissionConfigs}
                        onClick={() => copyCommissionRatesFromPreviousQuarter(quarter.quarter)}
                      >
                        Copiar de T{quarter.quarter - 1}
                      </button>
                    ) : null}
                  </div>
                  {canEditCommissionConfigs && quarter.sellers.length ? (
                    <CommissionBulkApply
                      quarter={quarter.quarter}
                      disabled={savingCommissionConfigs}
                      onApply={(values) => applyCommissionRatesToQuarter(quarter.quarter, values)}
                    />
                  ) : null}
                  <div className="commercial-planning-table-wrap">
                    <table className="commercial-planning-table commercial-planning-annual-commission-table">
                      <thead>
                        <tr>
                          <th>Vendedor</th>
                          <th>Cuota</th>
                          <th>% Productos</th>
                          <th>% Servicios</th>
                          <th>% Renovaciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {quarter.sellers.map((seller) => (
                          <tr key={`commission-config-${quarter.quarter}-${seller.sellerUserId}`}>
                            <td>
                              <strong>{seller.sellerUserName}</strong>
                              <div className="field-hint">{seller.sellerUserEmail}</div>
                              {Number(seller.salesQuotaAmount || 0) <= 0 ? (
                                <div className="commission-row-warning">Sin cuota en Metas: no podrá habilitar comisión.</div>
                              ) : [seller.productCommissionPct, seller.serviceCommissionPct, seller.renewalCommissionPct]
                                .every((rate) => Number(rate || 0) === 0) ? (
                                <div className="commission-row-warning">Sin porcentajes: no generará comisión.</div>
                              ) : null}
                            </td>
                            <td className="is-numeric">{formatAmount(seller.salesQuotaAmount)}</td>
                            <td>
                              <input
                                aria-label={`Productos ${seller.sellerUserName} T${quarter.quarter}`}
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={seller.productCommissionPct}
                                onChange={(event) => updateCommissionConfigDraft(
                                  quarter.quarter,
                                  seller.sellerUserId,
                                  "productCommissionPct",
                                  event.target.value,
                                )}
                                disabled={!canEditCommissionConfigs || savingCommissionConfigs}
                              />
                            </td>
                            <td>
                              <input
                                aria-label={`Servicios ${seller.sellerUserName} T${quarter.quarter}`}
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={seller.serviceCommissionPct}
                                onChange={(event) => updateCommissionConfigDraft(
                                  quarter.quarter,
                                  seller.sellerUserId,
                                  "serviceCommissionPct",
                                  event.target.value,
                                )}
                                disabled={!canEditCommissionConfigs || savingCommissionConfigs}
                              />
                            </td>
                            <td>
                              <input
                                aria-label={`Renovaciones ${seller.sellerUserName} T${quarter.quarter}`}
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={seller.renewalCommissionPct}
                                onChange={(event) => updateCommissionConfigDraft(
                                  quarter.quarter,
                                  seller.sellerUserId,
                                  "renewalCommissionPct",
                                  event.target.value,
                                )}
                                disabled={!canEditCommissionConfigs || savingCommissionConfigs}
                              />
                            </td>
                          </tr>
                        ))}
                        {!quarter.sellers.length ? (
                          <tr><td colSpan="5" className="centered">No hay vendedores elegibles.</td></tr>
                        ) : null}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td><strong>Cuota total</strong></td>
                          <td className="is-numeric">
                            <strong aria-label={`Cuota total T${quarter.quarter}`}>
                              {formatAmount(totalQuota)}
                            </strong>
                          </td>
                          <td colSpan="3" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </section>
                );
              })}
            </div>
            </>
          )}
        </div>
      ) : null}

      {activeTab === "commissionTracking" ? (
        <div className="commercial-planning-section-stack">
          <header className="commercial-planning-annual-header">
            <div>
              <h3>Seguimiento anual de comisiones</h3>
              <p>Consulta cuota, cumplimiento y comisiones de los cuatro trimestres.</p>
            </div>
            <div className="commercial-planning-annual-controls">
              <label>
                Año
                <select
                  aria-label="Año de seguimiento de comisiones"
                  value={commissionTrackingYear}
                  onChange={(event) => setCommissionTrackingYear(Number(event.target.value))}
                >
                  {Array.from({ length: 81 }, (_, index) => 2020 + index).map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </label>
            </div>
          </header>

          <CommissionRulesCard compact />

          {loadingCommissionTracking ? (
            <div className="field-hint">Calculando seguimiento de comisiones...</div>
          ) : (
            <CommissionTrackingView
              key={commissionTrackingYear}
              year={commissionTrackingYear}
              quarters={commissionTracking || []}
            />
          )}
        </div>
      ) : null}

      {activeTab === "sellerParameters" ? (
        <section className="commercial-planning-card">
          <div className="commercial-planning-card-header">
            <div>
              <h3>Configuración atemporal de parámetros por vendedor</h3>
              <p>
                Define ticket promedio, conversiones y tiempo promedio de
                conversión por vendedor. Estos parámetros no dependen de un
                período trimestral.
              </p>
            </div>
            {canUpdate ? (
              <button
                type="button"
                className="btn-primary"
                onClick={handleSaveSellerParameters}
                disabled={savingSellerParameters}
              >
                {savingSellerParameters ? "Guardando..." : "Guardar parámetros"}
              </button>
            ) : null}
          </div>

          {loadingSellerParameters ? (
            <div className="field-hint">Cargando parámetros de vendedor...</div>
          ) : (
            <div className="commercial-planning-table-wrap">
              <table className="commercial-planning-table">
                <thead>
                  <tr>
                    <th>Vendedor</th>
                    <th>Ticket promedio de venta</th>
                    <th>Relación leads → oportunidades</th>
                    <th>Relación oportunidades → ventas</th>
                    <th>Tiempo promedio oportunidad → venta (días)</th>
                    <th>Tiempo promedio desde etapa (días)</th>
                    <th>Fuente para probabilidad cuota</th>
                    <th>Última actualización</th>
                  </tr>
                </thead>
                <tbody>
                  {sellerParameterDrafts.map((item) => (
                    <tr key={`seller-parameter-${item.sellerUserId}`}>
                      <td>
                        <strong>{item.sellerUserName}</strong>
                        <div className="field-hint">{item.sellerUserEmail}</div>
                      </td>
                      <td>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={formatGroupedDecimalInput(
                            item.averageSaleTicketAmount,
                          )}
                          onChange={(event) =>
                            updateSellerParameterDraft(
                              item.sellerUserId,
                              "averageSaleTicketAmount",
                              normalizeDecimalInput(event.target.value),
                            )
                          }
                          disabled={!canUpdate}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={item.leadsToOpportunitiesRatio}
                          onChange={(event) =>
                            updateSellerParameterDraft(
                              item.sellerUserId,
                              "leadsToOpportunitiesRatio",
                              event.target.value,
                            )
                          }
                          disabled={!canUpdate}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={item.opportunitiesToWinsRatio}
                          onChange={(event) =>
                            updateSellerParameterDraft(
                              item.sellerUserId,
                              "opportunitiesToWinsRatio",
                              event.target.value,
                            )
                          }
                          disabled={!canUpdate}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.averageOpportunityToWinDays}
                          onChange={(event) =>
                            updateSellerParameterDraft(
                              item.sellerUserId,
                              "averageOpportunityToWinDays",
                              event.target.value,
                            )
                          }
                          disabled={!canUpdate}
                        />
                      </td>
                      <td>
                        <div className="seller-parameter-stage-breakdown">
                          {buildOpportunityToWinStageBreakdown(
                            item.averageOpportunityToWinDays,
                          ).map((stage) => (
                            <div
                              key={`seller-stage-${item.sellerUserId}-${stage.code}`}
                              className="seller-parameter-stage-breakdown-item"
                            >
                              <span>{stage.label}</span>
                              <strong>{formatDayValue(stage.days)}</strong>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="seller-parameter-source-grid">
                          <label className="seller-parameter-toggle">
                            <input
                              type="checkbox"
                              checked={
                                item.useHistoricalAverageSaleTicketForQuotaProbability !==
                                false
                              }
                              onChange={(event) =>
                                updateSellerParameterDraft(
                                  item.sellerUserId,
                                  "useHistoricalAverageSaleTicketForQuotaProbability",
                                  event.target.checked,
                                )
                              }
                              disabled={!canUpdate}
                            />
                            <span>Ticket promedio</span>
                            <strong>
                              {item.useHistoricalAverageSaleTicketForQuotaProbability !==
                              false
                                ? "Históricos"
                                : "Configuración"}
                            </strong>
                          </label>
                          <label className="seller-parameter-toggle">
                            <input
                              type="checkbox"
                              checked={
                                item.useHistoricalLeadsToOpportunitiesForQuotaProbability !==
                                false
                              }
                              onChange={(event) =>
                                updateSellerParameterDraft(
                                  item.sellerUserId,
                                  "useHistoricalLeadsToOpportunitiesForQuotaProbability",
                                  event.target.checked,
                                )
                              }
                              disabled={!canUpdate}
                            />
                            <span>Leads → oportunidades</span>
                            <strong>
                              {item.useHistoricalLeadsToOpportunitiesForQuotaProbability !==
                              false
                                ? "Históricos"
                                : "Configuración"}
                            </strong>
                          </label>
                          <label className="seller-parameter-toggle">
                            <input
                              type="checkbox"
                              checked={
                                item.useHistoricalOpportunitiesToWinsForQuotaProbability !==
                                false
                              }
                              onChange={(event) =>
                                updateSellerParameterDraft(
                                  item.sellerUserId,
                                  "useHistoricalOpportunitiesToWinsForQuotaProbability",
                                  event.target.checked,
                                )
                              }
                              disabled={!canUpdate}
                            />
                            <span>Oportunidades → ventas</span>
                            <strong>
                              {item.useHistoricalOpportunitiesToWinsForQuotaProbability !==
                              false
                                ? "Históricos"
                                : "Configuración"}
                            </strong>
                          </label>
                          <label className="seller-parameter-toggle">
                            <input
                              type="checkbox"
                              checked={
                                item.useHistoricalAverageOpportunityToWinDaysForQuotaProbability !==
                                false
                              }
                              onChange={(event) =>
                                updateSellerParameterDraft(
                                  item.sellerUserId,
                                  "useHistoricalAverageOpportunityToWinDaysForQuotaProbability",
                                  event.target.checked,
                                )
                              }
                              disabled={!canUpdate}
                            />
                            <span>Tiempo oportunidad → venta</span>
                            <strong>
                              {item.useHistoricalAverageOpportunityToWinDaysForQuotaProbability !==
                              false
                                ? "Históricos"
                                : "Configuración"}
                            </strong>
                          </label>
                        </div>
                        <div className="field-hint">
                          Cada switch define si usar históricos (con fallback a
                          configuración) o solo el valor configurado.
                        </div>
                      </td>
                      <td>
                        {item.updatedAt
                          ? formatDateTime(item.updatedAt)
                          : "Sin cambios"}
                        {item.updatedByUserName ? (
                          <div className="field-hint">
                            {item.updatedByUserName}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {!sellerParameterDrafts.length ? (
                    <tr>
                      <td colSpan="8" className="centered">
                        No hay vendedores elegibles para parametrizar.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
          {sellerParameterMeta?.sellers?.length ? (
            <p className="field-hint">
              Vendedores elegibles: {sellerParameterMeta.sellers.length}
            </p>
          ) : null}
        </section>
      ) : null}

      {activeTab === "audit" ? (
        <section className="commercial-planning-card">
          <div className="commercial-planning-card-header">
            <div>
              <h3>Auditoría del módulo</h3>
              <p>
                Historial del dominio aislado de Planeación Comercial para el
                período seleccionado.
              </p>
            </div>
          </div>

          {!canReadAudit ? (
            <div className="field-hint">
              No tienes permiso para consultar la auditoría del módulo.
            </div>
          ) : (
            <div className="commercial-planning-table-wrap">
              <table className="commercial-planning-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Actor</th>
                    <th>Acción</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{formatDateTime(entry.createdAt)}</td>
                      <td>
                        {entry.performedByName || "Sistema"}
                        {entry.performedByEmail ? (
                          <div className="field-hint">
                            {entry.performedByEmail}
                          </div>
                        ) : null}
                      </td>
                      <td>{entry.action}</td>
                      <td>{entry.detail || "Sin detalle"}</td>
                    </tr>
                  ))}
                  {!auditEntries.length ? (
                    <tr>
                      <td colSpan="4" className="centered">
                        No hay eventos de auditoría para el período
                        seleccionado.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </section>
  );
}
