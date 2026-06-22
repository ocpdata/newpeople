import { useEffect, useRef, useState } from "react";
import { api, getApiErrorMessage } from "./api";
import "./commercial-planning.css";

const TAB_OPTIONS = [
  { id: "summary", label: "Resumen" },
  { id: "periods", label: "Períodos" },
  { id: "targets", label: "Metas trimestrales" },
  { id: "commissionConfigs", label: "Comisiones · Configuración" },
  { id: "commissionTracking", label: "Comisiones · Seguimiento" },
  { id: "audit", label: "Auditoría" },
];

function formatCurrency(value, currencyCode = "USD") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: currencyCode || "USD",
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

function getPeriodStatusLabel(status) {
  if (status === "draft") return "Borrador";
  if (status === "active") return "Vigente";
  if (status === "closed") return "Cerrado";
  return status || "Sin estado";
}

function getVersionStatusLabel(status) {
  if (status === "draft") return "Borrador";
  if (status === "active") return "Vigente";
  if (status === "archived") return "Archivada";
  return status || "Sin estado";
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

function mergeTargetDrafts(versionDetail) {
  if (!versionDetail) return [];
  const targetsBySellerId = new Map(
    (versionDetail.targets || []).map((target) => [
      target.sellerUserId,
      target,
    ]),
  );

  return (versionDetail.eligibleSellers || []).map((seller) => {
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
        target?.currencyCode || versionDetail.version.baseCurrencyCode || "USD",
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

function buildTargetPayload(targetDrafts) {
  const errors = [];
  const targets = [];

  for (const draft of targetDrafts) {
    const hasQuota = String(draft.salesQuotaAmount).trim() !== "";
    const hasMargin = String(draft.expectedMarginPercent).trim() !== "";
    const hasNotes = String(draft.notes || "").trim() !== "";

    if (!hasQuota && !hasMargin && !hasNotes) {
      continue;
    }

    if (!hasQuota || !hasMargin) {
      errors.push(
        `Completa cuota y margen esperado para ${draft.sellerUserName} antes de guardar.`,
      );
      continue;
    }

    const salesQuotaAmount = Number(
      normalizeDecimalInput(draft.salesQuotaAmount),
    );
    const expectedMarginPercent = Number(draft.expectedMarginPercent);
    if (!(salesQuotaAmount > 0)) {
      errors.push(
        `La cuota de venta de ${draft.sellerUserName} debe ser mayor que cero.`,
      );
      continue;
    }
    if (Number.isNaN(expectedMarginPercent) || expectedMarginPercent < 0) {
      errors.push(
        `El margen esperado de ${draft.sellerUserName} debe ser mayor o igual a cero.`,
      );
      continue;
    }

    targets.push({
      sellerUserId: draft.sellerUserId,
      salesQuotaAmount,
      currencyCode: String(draft.currencyCode || "USD")
        .trim()
        .toUpperCase(),
      expectedMarginPercent,
      notes: String(draft.notes || "").trim() || null,
      status: draft.status || "complete",
    });
  }

  return { targets, errors };
}

function mergeCommissionConfigDrafts(payload) {
  return (payload?.sellers || []).map((seller) => ({
    sellerUserId: seller.sellerUserId,
    sellerUserName: seller.sellerUserName,
    sellerUserEmail: seller.sellerUserEmail,
    salesQuotaAmount: seller.salesQuotaAmount || 0,
    currencyCode:
      seller.currencyCode || payload?.period?.baseCurrencyCode || "USD",
    productCommissionPct: String(seller.productCommissionPct ?? 0),
    serviceCommissionPct: String(seller.serviceCommissionPct ?? 0),
    renewalCommissionPct: String(seller.renewalCommissionPct ?? 0),
    notes: seller.notes || "",
    updatedAt: seller.updatedAt || null,
    updatedByUserName: seller.updatedByUserName || "",
  }));
}

function buildCommissionConfigPayload(configDrafts) {
  const errors = [];
  const configs = (configDrafts || []).map((draft) => {
    const productCommissionPct = Number(
      normalizeDecimalInput(draft.productCommissionPct),
    );
    const serviceCommissionPct = Number(
      normalizeDecimalInput(draft.serviceCommissionPct),
    );
    const renewalCommissionPct = Number(
      normalizeDecimalInput(draft.renewalCommissionPct),
    );

    if (
      Number.isNaN(productCommissionPct) ||
      productCommissionPct < 0 ||
      Number.isNaN(serviceCommissionPct) ||
      serviceCommissionPct < 0 ||
      Number.isNaN(renewalCommissionPct) ||
      renewalCommissionPct < 0
    ) {
      errors.push(
        `Los porcentajes de comisión de ${draft.sellerUserName} deben ser mayores o iguales a cero.`,
      );
    }

    return {
      sellerUserId: draft.sellerUserId,
      productCommissionPct: Number.isNaN(productCommissionPct)
        ? 0
        : productCommissionPct,
      serviceCommissionPct: Number.isNaN(serviceCommissionPct)
        ? 0
        : serviceCommissionPct,
      renewalCommissionPct: Number.isNaN(renewalCommissionPct)
        ? 0
        : renewalCommissionPct,
      notes: String(draft.notes || "").trim() || null,
    };
  });

  return { configs, errors };
}

export default function CommercialPlanningPage({ can }) {
  const [activeTab, setActiveTab] = useState("summary");
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [periods, setPeriods] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState(null);
  const [selectedVersionId, setSelectedVersionId] = useState(null);
  const [periodDetail, setPeriodDetail] = useState(null);
  const [versionDetail, setVersionDetail] = useState(null);
  const [targetDrafts, setTargetDrafts] = useState([]);
  const [auditEntries, setAuditEntries] = useState([]);
  const [commissionConfigDrafts, setCommissionConfigDrafts] = useState([]);
  const [commissionConfigMeta, setCommissionConfigMeta] = useState(null);
  const [commissionTracking, setCommissionTracking] = useState(null);
  const [loadingCommissionConfigs, setLoadingCommissionConfigs] =
    useState(false);
  const [loadingCommissionTracking, setLoadingCommissionTracking] =
    useState(false);
  const [savingCommissionConfigs, setSavingCommissionConfigs] = useState(false);
  const [savingTargets, setSavingTargets] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [creatingVersion, setCreatingVersion] = useState(false);
  const [closingPeriod, setClosingPeriod] = useState(false);
  const [creatingPeriod, setCreatingPeriod] = useState(false);
  const [publishJustification, setPublishJustification] = useState("");
  const helpPopoverRef = useRef(null);
  const [periodForm, setPeriodForm] = useState(() => {
    const now = new Date();
    const quarter = Math.floor(now.getMonth() / 3) + 1;
    return {
      year: now.getFullYear(),
      quarter,
      baseCurrencyCode: "USD",
      notes: "",
    };
  });

  const canCreate = can("planeacion_comercial.create");
  const canUpdate = can("planeacion_comercial.update");
  const canPublish = can("planeacion_comercial.publish");
  const canClose = can("planeacion_comercial.close");
  const canReadAudit = can("planeacion_comercial.audit.read");
  const canOverrideValidation = can("planeacion_comercial.override_validation");

  async function selectPeriod(periodId, preferredVersionId = null) {
    if (!periodId) {
      setSelectedPeriodId(null);
      setSelectedVersionId(null);
      setPeriodDetail(null);
      setVersionDetail(null);
      setTargetDrafts([]);
      return;
    }

    const periodResponse = await api.get(
      `/api/commercial-planning/periods/${periodId}`,
    );
    const nextPeriodDetail = periodResponse.data;
    const versions = nextPeriodDetail.versions || [];
    const nextVersionId =
      preferredVersionId ||
      nextPeriodDetail.period.activeVersionId ||
      versions[0]?.id ||
      null;

    setSelectedPeriodId(periodId);
    setPeriodDetail(nextPeriodDetail);
    setSelectedVersionId(nextVersionId);

    if (nextVersionId) {
      const versionResponse = await api.get(
        `/api/commercial-planning/versions/${nextVersionId}`,
      );
      setVersionDetail(versionResponse.data);
      setTargetDrafts(mergeTargetDrafts(versionResponse.data));
      return;
    }

    setVersionDetail(null);
    setTargetDrafts([]);
  }

  async function loadPeriods(
    preferredPeriodId = null,
    preferredVersionId = null,
  ) {
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

      await selectPeriod(nextPeriodId, preferredVersionId || selectedVersionId);
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
      const nextCurrencies = response.data || [];
      setCurrencies(nextCurrencies);
      if (nextCurrencies.length) {
        setPeriodForm((current) => {
          const currentCode = String(current.baseCurrencyCode || "").trim();
          const hasCurrentCode = nextCurrencies.some(
            (option) => String(option.code || "") === currentCode,
          );
          return {
            ...current,
            baseCurrencyCode: hasCurrentCode
              ? currentCode
              : String(nextCurrencies[0].code || "USD"),
          };
        });
      }
    } catch {
      setCurrencies([]);
    }
  }

  async function loadVersion(versionId) {
    if (!versionId) {
      setVersionDetail(null);
      setTargetDrafts([]);
      return;
    }

    setError("");
    try {
      const versionResponse = await api.get(
        `/api/commercial-planning/versions/${versionId}`,
      );
      setVersionDetail(versionResponse.data);
      setTargetDrafts(mergeTargetDrafts(versionResponse.data));
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar la versión seleccionada",
        ),
      );
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

  async function loadCommissionConfigs() {
    if (!selectedPeriodId) return;
    setLoadingCommissionConfigs(true);
    try {
      const response = await api.get(
        `/api/commercial-planning/periods/${selectedPeriodId}/commission-configs`,
        {
          params: {
            versionId: selectedVersionId || undefined,
          },
        },
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

  async function loadCommissionTracking() {
    if (!selectedPeriodId) return;
    setLoadingCommissionTracking(true);
    try {
      const response = await api.get(
        `/api/commercial-planning/periods/${selectedPeriodId}/commission-tracking`,
        {
          params: {
            versionId: selectedVersionId || undefined,
          },
        },
      );
      setCommissionTracking(response.data);
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

  useEffect(() => {
    // Initial page bootstrap intentionally triggers these data loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPeriods();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCurrencies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedVersionId) return;
    if (versionDetail?.version?.id === selectedVersionId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadVersion(selectedVersionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVersionId]);

  useEffect(() => {
    if (activeTab === "audit") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadAudit();
    }
    if (activeTab === "commissionConfigs") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadCommissionConfigs();
    }
    if (activeTab === "commissionTracking") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadCommissionTracking();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, periodDetail?.period?.id, selectedVersionId]);

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

  function updateTargetDraft(sellerUserId, field, value) {
    setTargetDrafts((current) =>
      current.map((item) =>
        item.sellerUserId === sellerUserId ? { ...item, [field]: value } : item,
      ),
    );
  }

  function updateCommissionConfigDraft(sellerUserId, field, value) {
    setCommissionConfigDrafts((current) =>
      current.map((item) =>
        item.sellerUserId === sellerUserId ? { ...item, [field]: value } : item,
      ),
    );
  }

  async function handleCreatePeriod(event) {
    event.preventDefault();
    setCreatingPeriod(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.post("/api/commercial-planning/periods", {
        year: Number(periodForm.year),
        quarter: Number(periodForm.quarter),
        baseCurrencyCode: String(periodForm.baseCurrencyCode || "USD")
          .trim()
          .toUpperCase(),
        notes: String(periodForm.notes || "").trim() || null,
      });
      setSuccess(response.data.message);
      await loadPeriods(
        response.data.period.id,
        response.data.createdVersionId,
      );
      setActiveTab("targets");
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible crear el período de planeación",
        ),
      );
    } finally {
      setCreatingPeriod(false);
    }
  }

  async function handleSaveTargets() {
    if (!versionDetail?.version?.id) return;
    const payload = buildTargetPayload(targetDrafts);
    if (payload.errors.length) {
      setError(payload.errors[0]);
      return;
    }

    setSavingTargets(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.put(
        `/api/commercial-planning/versions/${versionDetail.version.id}/targets`,
        { targets: payload.targets },
      );
      setSuccess(response.data.message);
      await loadPeriods(selectedPeriodId, versionDetail.version.id);
      setSelectedVersionId(versionDetail.version.id);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible guardar las metas trimestrales",
        ),
      );
    } finally {
      setSavingTargets(false);
    }
  }

  async function handleCreateVersion() {
    if (!periodDetail?.period?.id) return;
    setCreatingVersion(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.post(
        `/api/commercial-planning/periods/${periodDetail.period.id}/versions`,
        {},
      );
      setSuccess(response.data.message);
      await loadPeriods(periodDetail.period.id, response.data.version.id);
      setActiveTab("targets");
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible crear una nueva versión",
        ),
      );
    } finally {
      setCreatingVersion(false);
    }
  }

  async function handlePublishVersion() {
    if (!versionDetail?.version?.id) return;
    setPublishing(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.post(
        `/api/commercial-planning/versions/${versionDetail.version.id}/publish`,
        {
          justification: String(publishJustification || "").trim() || null,
        },
      );
      setSuccess(response.data.message);
      setPublishJustification("");
      await loadPeriods(selectedPeriodId, versionDetail.version.id);
      setActiveTab("summary");
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible publicar la versión seleccionada",
        ),
      );
    } finally {
      setPublishing(false);
    }
  }

  async function handleClosePeriod() {
    if (!periodDetail?.period?.id) return;
    setClosingPeriod(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.post(
        `/api/commercial-planning/periods/${periodDetail.period.id}/close`,
        {},
      );
      setSuccess(response.data.message);
      await loadPeriods(periodDetail.period.id, selectedVersionId);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cerrar el período seleccionado",
        ),
      );
    } finally {
      setClosingPeriod(false);
    }
  }

  async function handleSaveCommissionConfigs() {
    if (!selectedPeriodId) return;
    const payload = buildCommissionConfigPayload(commissionConfigDrafts);
    if (payload.errors.length) {
      setError(payload.errors[0]);
      return;
    }

    setSavingCommissionConfigs(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.put(
        `/api/commercial-planning/periods/${selectedPeriodId}/commission-configs`,
        payload,
        {
          params: {
            versionId: selectedVersionId || undefined,
          },
        },
      );
      setSuccess(response.data.message);
      setCommissionConfigMeta(response.data);
      setCommissionConfigDrafts(mergeCommissionConfigDrafts(response.data));
      await loadCommissionTracking();
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

  if (loading) {
    return (
      <section className="panel centered">
        Cargando planeación comercial...
      </section>
    );
  }

  const hasPeriods = periods.length > 0;
  const hasVersions = (periodDetail?.versions || []).length > 0;
  const summary = versionDetail?.version || null;
  const validation = versionDetail?.validation || { errors: [], warnings: [] };
  const eligibleSellerCount = versionDetail?.eligibleSellers?.length || 0;
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
                    Centraliza la planeación trimestral por vendedor para
                    definir cuota, margen esperado y contribución antes de
                    publicar una versión oficial.
                  </p>
                  <strong>Cómo usarlo</strong>
                  <ol className="commercial-planning-help-list">
                    <li>Selecciona o crea el período del trimestre.</li>
                    <li>Genera una versión en borrador.</li>
                    <li>Captura o ajusta metas por vendedor.</li>
                    <li>
                      Revisa validaciones y publica cuando la versión quede
                      lista.
                    </li>
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

      <div className="commercial-planning-context-bar">
        <div className="commercial-planning-context-copy">
          <div className="commercial-planning-toolbar-title">Vista activa</div>
          <div className="commercial-planning-context-controls">
            <label>
              Período
              <select
                value={selectedPeriodId || ""}
                onChange={async (event) => {
                  const nextPeriodId = Number(event.target.value) || null;
                  setError("");
                  try {
                    await selectPeriod(nextPeriodId);
                  } catch (requestError) {
                    setError(
                      getApiErrorMessage(
                        requestError,
                        "No fue posible cargar el período seleccionado",
                      ),
                    );
                  }
                }}
                disabled={!hasPeriods}
              >
                {!hasPeriods ? (
                  <option value="">No hay períodos creados</option>
                ) : null}
                {periods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.label} · {getPeriodStatusLabel(period.status)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Versión
              <select
                value={selectedVersionId || ""}
                onChange={async (event) => {
                  const nextVersionId = Number(event.target.value) || null;
                  setSelectedVersionId(nextVersionId);
                  setError("");
                  try {
                    await loadVersion(nextVersionId);
                  } catch (requestError) {
                    setError(
                      getApiErrorMessage(
                        requestError,
                        "No fue posible cargar la versión seleccionada",
                      ),
                    );
                  }
                }}
                disabled={!hasVersions}
              >
                {!hasVersions ? (
                  <option value="">
                    {hasPeriods
                      ? "Sin versiones disponibles"
                      : "Selecciona o crea un período primero"}
                  </option>
                ) : null}
                {(periodDetail?.versions || []).map((version) => (
                  <option key={version.id} value={version.id}>
                    {`Versión ${version.versionNumber}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="commercial-planning-toolbar-actions">
          {canCreate ? (
            <button
              type="button"
              className="btn-secondary commercial-planning-action-button is-compact"
              onClick={handleCreateVersion}
              disabled={
                !periodDetail?.period ||
                creatingVersion ||
                periodDetail?.period?.status === "closed"
              }
            >
              <span className="commercial-planning-action-button-label">
                {creatingVersion ? "Creando versión..." : "Nueva versión"}
              </span>
              <span className="commercial-planning-action-button-hint">
                Nuevo borrador
              </span>
            </button>
          ) : null}
          {canPublish ? (
            <button
              type="button"
              className="btn-primary commercial-planning-action-button is-primary is-compact"
              onClick={handlePublishVersion}
              disabled={
                !versionDetail?.version ||
                publishing ||
                versionDetail?.version?.status !== "draft"
              }
            >
              <span className="commercial-planning-action-button-label">
                {publishing ? "Publicando..." : "Publicar versión"}
              </span>
              <span className="commercial-planning-action-button-hint">
                Hacer oficial
              </span>
            </button>
          ) : null}
          {canClose ? (
            <button
              type="button"
              className="btn-secondary commercial-planning-action-button is-compact"
              onClick={handleClosePeriod}
              disabled={
                !periodDetail?.period ||
                closingPeriod ||
                periodDetail?.period?.status === "closed"
              }
            >
              <span className="commercial-planning-action-button-label">
                {closingPeriod ? "Bloqueando..." : "Bloquear periodo"}
              </span>
              <span className="commercial-planning-action-button-hint">
                Evita cambios adicionales
              </span>
            </button>
          ) : null}
        </div>
      </div>

      {!hasPeriods ? (
        <section className="commercial-planning-empty-state">
          <div>
            <h3>Aún no hay períodos de planeación</h3>
            <p>
              Los selectores de Período y Versión están vacíos porque todavía no
              existe ningún trimestre creado en este módulo.
            </p>
          </div>
          {canCreate ? (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setActiveTab("periods")}
            >
              Crear primer período
            </button>
          ) : (
            <p className="field-hint">
              Necesitas permiso de creación para dar de alta el primer período.
            </p>
          )}
        </section>
      ) : null}

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
                    Versión seleccionada
                  </span>
                  <h3>{summary?.label || "Selecciona una versión"}</h3>
                </div>
                <div className="commercial-planning-context-pills">
                  <span className="commercial-planning-status-pill">
                    {summary
                      ? getVersionStatusLabel(summary.status)
                      : "Sin versión"}
                  </span>
                  {summary?.baseCurrencyCode ? (
                    <span className="commercial-planning-status-pill">
                      {summary.baseCurrencyCode}
                    </span>
                  ) : null}
                  <span
                    className={`commercial-planning-status-pill commercial-planning-target-pill ${pendingTargetsCount ? "is-warn" : ""}`.trim()}
                    data-tooltip={
                      pendingTargetsCount
                        ? `${pendingTargetsCount} vendedores activos aún no tienen meta completa en esta versión.`
                        : "Todos los vendedores activos ya tienen meta completa en esta versión."
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
                    Cuota, margen esperado y contribución estimada de la versión
                    seleccionada.
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
                      <th>Estado</th>
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
                        <td>{getPeriodStatusLabel(period.status)}</td>
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
                        <strong>Total anual {activeYear}</strong>
                      </td>
                      <td>{yearlyPeriods.length} trimestres</td>
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

          <section className="commercial-planning-card">
            <div className="commercial-planning-card-header">
              <div>
                <h3>Revisión antes de publicar</h3>
                <p>
                  La publicación exige errores duros en cero. Las advertencias
                  pueden publicarse solo con justificación y permiso especial.
                </p>
              </div>
            </div>

            <div className="commercial-planning-validation-grid">
              <div className="commercial-planning-validation-panel">
                <strong>Errores duros</strong>
                {(validation.errors || []).length ? (
                  <ul className="commercial-planning-list">
                    {validation.errors.map((item) => (
                      <li key={item.code + item.message}>{item.message}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="field-hint">
                    Sin errores duros en la versión seleccionada.
                  </p>
                )}
              </div>
              <div className="commercial-planning-validation-panel">
                <strong>Advertencias justificables</strong>
                {(validation.warnings || []).length ? (
                  <ul className="commercial-planning-list">
                    {validation.warnings.map((item) => (
                      <li key={item.code + item.message}>{item.message}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="field-hint">Sin advertencias justificables.</p>
                )}
              </div>
            </div>

            {canPublish && versionDetail?.version?.status === "draft" ? (
              <div className="commercial-planning-justification-box">
                <label>
                  Justificación de publicación
                  <textarea
                    rows="3"
                    value={publishJustification}
                    onChange={(event) =>
                      setPublishJustification(event.target.value)
                    }
                    placeholder={
                      canOverrideValidation
                        ? "Solo es obligatoria si publicas con advertencias justificables."
                        : "No tienes permiso para publicar con advertencias; corrige la versión antes de publicarla."
                    }
                  />
                </label>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {activeTab === "targets" ? (
        <section className="commercial-planning-card">
          <div className="commercial-planning-card-header">
            <div>
              <h3>Metas trimestrales por vendedor</h3>
              <p>
                La tabla trabaja sobre la versión seleccionada. Deja vacío a un
                vendedor si quieres que quede como advertencia justificable al
                publicar.
              </p>
            </div>
            {canUpdate ? (
              <button
                type="button"
                className="btn-primary"
                onClick={handleSaveTargets}
                disabled={
                  savingTargets ||
                  !versionDetail?.version ||
                  versionDetail?.version?.status !== "draft"
                }
              >
                {savingTargets ? "Guardando..." : "Guardar borrador"}
              </button>
            ) : null}
          </div>

          <div className="commercial-planning-table-wrap">
            <table className="commercial-planning-table">
              <thead>
                <tr>
                  <th>Vendedor</th>
                  <th>Cuota de venta</th>
                  <th>Moneda</th>
                  <th>Margen esperado %</th>
                  <th>Contribución esperada</th>
                  <th>Observaciones</th>
                  <th>Última actualización</th>
                </tr>
              </thead>
              <tbody>
                {targetDrafts.map((item) => {
                  const contribution =
                    Number(normalizeDecimalInput(item.salesQuotaAmount) || 0) *
                    (Number(item.expectedMarginPercent || 0) / 100);
                  return (
                    <tr key={item.sellerUserId}>
                      <td>
                        <strong>{item.sellerUserName}</strong>
                        <div className="field-hint">{item.sellerEmail}</div>
                      </td>
                      <td>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={formatGroupedDecimalInput(
                            item.salesQuotaAmount,
                          )}
                          onChange={(event) =>
                            updateTargetDraft(
                              item.sellerUserId,
                              "salesQuotaAmount",
                              normalizeDecimalInput(event.target.value),
                            )
                          }
                          disabled={
                            !canUpdate ||
                            versionDetail?.version?.status !== "draft"
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={item.currencyCode}
                          onChange={(event) =>
                            updateTargetDraft(
                              item.sellerUserId,
                              "currencyCode",
                              event.target.value.toUpperCase(),
                            )
                          }
                          maxLength={10}
                          disabled={
                            !canUpdate ||
                            versionDetail?.version?.status !== "draft"
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.expectedMarginPercent}
                          onChange={(event) =>
                            updateTargetDraft(
                              item.sellerUserId,
                              "expectedMarginPercent",
                              event.target.value,
                            )
                          }
                          disabled={
                            !canUpdate ||
                            versionDetail?.version?.status !== "draft"
                          }
                        />
                      </td>
                      <td>
                        {formatCurrency(
                          contribution,
                          item.currencyCode ||
                            summary?.baseCurrencyCode ||
                            "USD",
                        )}
                      </td>
                      <td>
                        <textarea
                          rows="2"
                          value={item.notes}
                          onChange={(event) =>
                            updateTargetDraft(
                              item.sellerUserId,
                              "notes",
                              event.target.value,
                            )
                          }
                          disabled={
                            !canUpdate ||
                            versionDetail?.version?.status !== "draft"
                          }
                        />
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
                  );
                })}
                {!targetDrafts.length ? (
                  <tr>
                    <td colSpan="7" className="centered">
                      No hay vendedores elegibles para capturar metas.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === "commissionConfigs" ? (
        <section className="commercial-planning-card">
          <div className="commercial-planning-card-header">
            <div>
              <h3>Configuración trimestral de comisiones</h3>
              <p>
                Define los porcentajes de productos, servicios y renovaciones
                por vendedor para el período seleccionado.
              </p>
            </div>
            {canUpdate ? (
              <button
                type="button"
                className="btn-primary"
                onClick={handleSaveCommissionConfigs}
                disabled={
                  savingCommissionConfigs ||
                  !selectedPeriodId ||
                  commissionConfigMeta?.period?.status === "closed"
                }
              >
                {savingCommissionConfigs
                  ? "Guardando..."
                  : "Guardar configuración"}
              </button>
            ) : null}
          </div>

          {loadingCommissionConfigs ? (
            <div className="field-hint">
              Cargando configuración de comisiones...
            </div>
          ) : (
            <div className="commercial-planning-table-wrap">
              <table className="commercial-planning-table">
                <thead>
                  <tr>
                    <th>Vendedor</th>
                    <th>Cuota</th>
                    <th>% Productos</th>
                    <th>% Servicios</th>
                    <th>% Renovaciones</th>
                    <th>Notas</th>
                    <th>Última actualización</th>
                  </tr>
                </thead>
                <tbody>
                  {commissionConfigDrafts.map((item) => (
                    <tr key={`commission-config-${item.sellerUserId}`}>
                      <td>
                        <strong>{item.sellerUserName}</strong>
                        <div className="field-hint">{item.sellerUserEmail}</div>
                      </td>
                      <td>
                        {formatCurrency(
                          item.salesQuotaAmount || 0,
                          item.currencyCode ||
                            commissionConfigMeta?.period?.baseCurrencyCode ||
                            "USD",
                        )}
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.productCommissionPct}
                          onChange={(event) =>
                            updateCommissionConfigDraft(
                              item.sellerUserId,
                              "productCommissionPct",
                              event.target.value,
                            )
                          }
                          disabled={
                            !canUpdate ||
                            commissionConfigMeta?.period?.status === "closed"
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.serviceCommissionPct}
                          onChange={(event) =>
                            updateCommissionConfigDraft(
                              item.sellerUserId,
                              "serviceCommissionPct",
                              event.target.value,
                            )
                          }
                          disabled={
                            !canUpdate ||
                            commissionConfigMeta?.period?.status === "closed"
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.renewalCommissionPct}
                          onChange={(event) =>
                            updateCommissionConfigDraft(
                              item.sellerUserId,
                              "renewalCommissionPct",
                              event.target.value,
                            )
                          }
                          disabled={
                            !canUpdate ||
                            commissionConfigMeta?.period?.status === "closed"
                          }
                        />
                      </td>
                      <td>
                        <textarea
                          rows="2"
                          value={item.notes}
                          onChange={(event) =>
                            updateCommissionConfigDraft(
                              item.sellerUserId,
                              "notes",
                              event.target.value,
                            )
                          }
                          disabled={
                            !canUpdate ||
                            commissionConfigMeta?.period?.status === "closed"
                          }
                        />
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
                  {!commissionConfigDrafts.length ? (
                    <tr>
                      <td colSpan="7" className="centered">
                        No hay vendedores elegibles para configurar comisiones.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "commissionTracking" ? (
        <div className="commercial-planning-section-stack">
          <section className="commercial-planning-card">
            <div className="commercial-planning-card-header">
              <div>
                <h3>Seguimiento trimestral de comisiones</h3>
                <p>
                  Consolida cuota, cumplimiento, margen elegible y comisión
                  calculada sobre cotizaciones aceptadas del trimestre.
                </p>
              </div>
            </div>

            {loadingCommissionTracking ? (
              <div className="field-hint">
                Calculando seguimiento de comisiones...
              </div>
            ) : (
              <div className="commercial-planning-table-wrap">
                <table className="commercial-planning-table">
                  <thead>
                    <tr>
                      <th>Vendedor</th>
                      <th>Cuota</th>
                      <th>Venta aceptada</th>
                      <th>% cumplimiento</th>
                      <th>Habilitado</th>
                      <th>Cot. elegibles</th>
                      <th>Bloqueadas margen</th>
                      <th>Contribución elegible</th>
                      <th>Comisión total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(commissionTracking?.summaries || []).map((item) => {
                      const eligibleContribution =
                        Number(item.eligibleProductContributionAmount || 0) +
                        Number(item.eligibleServiceContributionAmount || 0) +
                        Number(item.eligibleRenewalContributionAmount || 0);

                      return (
                        <tr key={`commission-summary-${item.sellerUserId}`}>
                          <td>
                            <strong>{item.sellerUserName}</strong>
                            <div className="field-hint">
                              {item.sellerUserEmail}
                            </div>
                          </td>
                          <td>
                            {formatCurrency(
                              item.salesQuotaAmount || 0,
                              item.currencyCode ||
                                commissionTracking?.baseCurrencyCode ||
                                "USD",
                            )}
                          </td>
                          <td>
                            {formatCurrency(
                              item.acceptedSalesAmount || 0,
                              item.currencyCode ||
                                commissionTracking?.baseCurrencyCode ||
                                "USD",
                            )}
                          </td>
                          <td>{formatPercent(item.quotaAttainmentPct || 0)}</td>
                          <td>{item.commissionEnabled ? "Sí" : "No"}</td>
                          <td>{item.eligibleQuotationCount || 0}</td>
                          <td>{item.blockedLowMarginQuotationCount || 0}</td>
                          <td>
                            {formatCurrency(
                              eligibleContribution,
                              item.currencyCode ||
                                commissionTracking?.baseCurrencyCode ||
                                "USD",
                            )}
                          </td>
                          <td>
                            {formatCurrency(
                              item.calculatedTotalCommissionAmount || 0,
                              item.currencyCode ||
                                commissionTracking?.baseCurrencyCode ||
                                "USD",
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {!(commissionTracking?.summaries || []).length ? (
                      <tr>
                        <td colSpan="9" className="centered">
                          No hay datos de comisiones para el período
                          seleccionado.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {!loadingCommissionTracking
            ? (commissionTracking?.summaries || []).map((seller) => (
                <section
                  key={`commission-detail-${seller.sellerUserId}`}
                  className="commercial-planning-card"
                >
                  <div className="commercial-planning-card-header">
                    <div>
                      <h3>{seller.sellerUserName}</h3>
                      <p>
                        Detalle de cotizaciones aceptadas y cálculo por item del
                        trimestre.
                      </p>
                    </div>
                  </div>

                  <div className="commercial-planning-table-wrap">
                    <table className="commercial-planning-table commercial-planning-commission-detail-table">
                      <thead>
                        <tr>
                          <th>Cotización</th>
                          <th>Fecha aceptación</th>
                          <th>Cuenta</th>
                          <th>Venta</th>
                          <th>Margen</th>
                          <th>Estado</th>
                          <th>Comisión</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(seller.quotations || []).map((quotation) => (
                          <tr
                            key={`quotation-${seller.sellerUserId}-${quotation.quotationId}`}
                          >
                            <td>
                              <strong>{quotation.proposalName}</strong>
                              <div className="field-hint">
                                #{quotation.quotationId}
                              </div>
                            </td>
                            <td>{formatDateTime(quotation.acceptedAt)}</td>
                            <td>
                              {quotation.accountName}
                              {quotation.opportunityName ? (
                                <div className="field-hint">
                                  {quotation.opportunityName}
                                </div>
                              ) : null}
                            </td>
                            <td>
                              {formatCurrency(
                                quotation.totalSaleAmount || 0,
                                seller.currencyCode ||
                                  commissionTracking?.baseCurrencyCode ||
                                  "USD",
                              )}
                            </td>
                            <td>
                              {formatPercent(quotation.quotationMarginPct || 0)}
                            </td>
                            <td>
                              {!quotation.passesMarginRule
                                ? "Bloqueada por margen"
                                : !quotation.sellerPassesQuotaRule
                                  ? "Bloqueada por cuota"
                                  : "Elegible"}
                            </td>
                            <td>
                              {formatCurrency(
                                (quotation.items || []).reduce(
                                  (sum, item) =>
                                    sum + Number(item.commissionAmount || 0),
                                  0,
                                ),
                                seller.currencyCode ||
                                  commissionTracking?.baseCurrencyCode ||
                                  "USD",
                              )}
                            </td>
                          </tr>
                        ))}
                        {!(seller.quotations || []).length ? (
                          <tr>
                            <td colSpan="7" className="centered">
                              Sin cotizaciones aceptadas para este vendedor en
                              el trimestre.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))
            : null}
        </div>
      ) : null}

      {activeTab === "periods" ? (
        <div className="commercial-planning-periods-grid">
          <section className="commercial-planning-card commercial-planning-periods-card">
            <div className="commercial-planning-card-header">
              <div>
                <h3>Períodos existentes</h3>
                <p>
                  Consulta el historial trimestral y abre cualquier período para
                  revisar sus versiones y totales.
                </p>
              </div>
            </div>

            <div className="commercial-planning-table-wrap">
              <table className="commercial-planning-table commercial-planning-periods-table">
                <thead>
                  <tr>
                    <th>Periodo</th>
                    <th>Estado</th>
                    <th>Versiones</th>
                    <th>Versión vigente</th>
                    <th>Cuota total</th>
                    <th>Contribución</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((period) => (
                    <tr
                      key={period.id}
                      className={
                        selectedPeriodId === period.id ? "is-selected" : ""
                      }
                      onClick={async () => {
                        setError("");
                        try {
                          await selectPeriod(period.id);
                        } catch (requestError) {
                          setError(
                            getApiErrorMessage(
                              requestError,
                              "No fue posible cargar el período seleccionado",
                            ),
                          );
                        }
                      }}
                    >
                      <td>{period.label}</td>
                      <td>{getPeriodStatusLabel(period.status)}</td>
                      <td>{period.versionCount}</td>
                      <td>
                        {period.activeVersionNumber
                          ? `Versión ${period.activeVersionNumber}`
                          : "Sin versión vigente"}
                      </td>
                      <td>
                        {formatCurrency(
                          period.totalQuotaAmount,
                          period.baseCurrencyCode,
                        )}
                      </td>
                      <td>
                        {formatCurrency(
                          period.totalContributionAmount,
                          period.baseCurrencyCode,
                        )}
                      </td>
                    </tr>
                  ))}
                  {!periods.length ? (
                    <tr>
                      <td colSpan="6" className="centered">
                        No hay períodos creados todavía.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          {canCreate ? (
            <section className="commercial-planning-card commercial-planning-period-create-card">
              <div className="commercial-planning-card-header">
                <div>
                  <h3>Crear período trimestral</h3>
                  <p>
                    Da de alta un nuevo trimestre y genera su Versión 1 en
                    borrador para iniciar la planeación.
                  </p>
                </div>
              </div>

              <div className="commercial-planning-create-period-note">
                El nuevo período quedará listo para capturar metas apenas se
                cree.
              </div>

              <form
                className="commercial-planning-form-grid commercial-planning-period-form"
                onSubmit={handleCreatePeriod}
              >
                <div className="commercial-planning-period-form-top">
                  <label className="commercial-planning-period-field commercial-planning-period-field-year">
                    <span className="commercial-planning-period-field-label">
                      Año
                    </span>
                    <input
                      type="number"
                      value={periodForm.year}
                      onChange={(event) =>
                        setPeriodForm((current) => ({
                          ...current,
                          year: event.target.value,
                        }))
                      }
                      min="2020"
                      max="2100"
                    />
                  </label>
                  <label className="commercial-planning-period-field commercial-planning-period-field-quarter">
                    <span className="commercial-planning-period-field-label">
                      Trimestre
                    </span>
                    <select
                      value={periodForm.quarter}
                      onChange={(event) =>
                        setPeriodForm((current) => ({
                          ...current,
                          quarter: event.target.value,
                        }))
                      }
                    >
                      <option value="1">T1</option>
                      <option value="2">T2</option>
                      <option value="3">T3</option>
                      <option value="4">T4</option>
                    </select>
                  </label>
                  <label className="commercial-planning-period-field commercial-planning-period-field-currency">
                    <span className="commercial-planning-period-field-label">
                      Moneda
                    </span>
                    <select
                      value={periodForm.baseCurrencyCode}
                      onChange={(event) =>
                        setPeriodForm((current) => ({
                          ...current,
                          baseCurrencyCode: event.target.value,
                        }))
                      }
                    >
                      {withCurrentCatalogOption(
                        currencies,
                        periodForm.baseCurrencyCode,
                      ).map((currency) => (
                        <option
                          key={currency.id || currency.code}
                          value={currency.code}
                        >
                          {currency.code}
                          {currency.name ? ` - ${currency.name}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="commercial-planning-period-field is-wide">
                  Nota inicial
                  <textarea
                    rows="4"
                    value={periodForm.notes}
                    onChange={(event) =>
                      setPeriodForm((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                    placeholder="Observación general del trimestre"
                  />
                </label>
                <div className="commercial-planning-form-actions">
                  <button
                    type="submit"
                    className="btn-primary commercial-planning-create-period-button"
                    disabled={creatingPeriod}
                  >
                    {creatingPeriod ? "Creando período..." : "Crear período"}
                  </button>
                </div>
              </form>
            </section>
          ) : null}
        </div>
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
