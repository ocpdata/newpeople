import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getApiErrorMessage } from "./api";
import "./commercial-tracking.css";

const TAB_OPTIONS = [
  { id: "overview", label: "Resumen" },
  { id: "open", label: "Abiertas" },
  { id: "period", label: "Oportunidades por periodo" },
  { id: "forecast", label: "Pipeline mensual" },
];

const QUICK_FILTER_OPTIONS = [
  { id: "all", label: "Todas" },
  { id: "blocked", label: "Bloqueadas" },
  { id: "no_next_step", label: "Sin siguiente paso" },
  { id: "stale", label: "Sin actividad" },
  { id: "advanced_this_week", label: "Avanzadas semana" },
  { id: "waiting_internal", label: "Esperando interno" },
  { id: "waiting_customer", label: "Esperando cliente" },
];

const COMMERCIAL_STAGE_ORDER = {
  contacto_inicial: 1,
  identificacion_oportunidad: 2,
  desarrollo: 3,
  cotizacion: 4,
  demostracion: 5,
  negociacion: 6,
  waiting: 7,
};

const FORECAST_SORT_DEFAULT = {
  field: "amountUsd",
  direction: "desc",
};

function getCurrentWeekStart() {
  const now = new Date();
  const day = now.getDay() || 7;
  if (day !== 1) {
    now.setDate(now.getDate() - (day - 1));
  }
  now.setHours(0, 0, 0, 0);
  return now.toISOString().slice(0, 10);
}

function getWeekStartDate(value = new Date()) {
  const candidate = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(candidate.getTime())) {
    return getWeekStartDate(new Date());
  }

  const normalized = new Date(
    candidate.getFullYear(),
    candidate.getMonth(),
    candidate.getDate(),
    12,
  );
  const day = normalized.getDay() || 7;
  if (day !== 1) {
    normalized.setDate(normalized.getDate() - (day - 1));
  }
  return normalized;
}

function formatIsoWeekStart(value = new Date()) {
  const weekStart = getWeekStartDate(value);
  return `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, "0")}-${String(weekStart.getDate()).padStart(2, "0")}`;
}

function formatWeekOptionLabel(weekStartValue) {
  const weekStart = getWeekStartDate(`${weekStartValue}T12:00:00`);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const formatPart = (date, includeYear = false) =>
    date.toLocaleDateString("es-MX", {
      day: "2-digit",
      month: "short",
      ...(includeYear ? { year: "numeric" } : {}),
    });

  if (weekStart.getFullYear() !== weekEnd.getFullYear()) {
    return `${formatPart(weekStart, true)} - ${formatPart(weekEnd, true)}`;
  }

  return `${formatPart(weekStart)} - ${formatPart(weekEnd, true)}`;
}

function buildCockpitWeekOptions(selectedWeekStart) {
  const currentWeek = getCurrentWeekStart();
  const selectedWeek = selectedWeekStart || currentWeek;
  const optionMap = new Map();
  const currentWeekDate = getWeekStartDate(`${currentWeek}T12:00:00`);

  Array.from({ length: 16 }, (_, index) => {
    const offset = 3 - index;
    const optionDate = new Date(currentWeekDate);
    optionDate.setDate(optionDate.getDate() + offset * 7);
    const value = formatIsoWeekStart(optionDate);
    optionMap.set(value, {
      value,
      label: formatWeekOptionLabel(value),
    });
    return null;
  });

  if (!optionMap.has(selectedWeek)) {
    optionMap.set(selectedWeek, {
      value: selectedWeek,
      label: formatWeekOptionLabel(selectedWeek),
    });
  }

  return Array.from(optionMap.values()).sort((left, right) =>
    String(right.value).localeCompare(String(left.value)),
  );
}

function getCurrentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function getQuarterKeyForDate(rawDate) {
  const value = String(rawDate || "").trim();
  if (!value) {
    return "";
  }
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return `${date.getFullYear()}-${quarter}`;
}

function formatMonthLabel(value) {
  if (!value) return "Sin mes";
  const parsed = new Date(`${value}-01T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  const label = parsed.toLocaleDateString("es-MX", {
    month: "long",
    year: "numeric",
  });
  return label
    .replace(/\s+de\s+/i, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function buildForecastMonthOptions(selectedMonth) {
  const baseMonth = selectedMonth || getCurrentMonth();
  const [yearPart, monthPart] = String(baseMonth).split("-");
  const year = Number(yearPart);
  const monthIndex = Number(monthPart) - 1;
  const anchor = new Date(
    Number.isFinite(year) ? year : new Date().getFullYear(),
    Number.isFinite(monthIndex) ? monthIndex : new Date().getMonth(),
    1,
  );

  return Array.from({ length: 24 }, (_, index) => {
    const optionDate = new Date(
      anchor.getFullYear(),
      anchor.getMonth() - 11 + index,
      1,
    );
    const optionValue = `${optionDate.getFullYear()}-${String(optionDate.getMonth() + 1).padStart(2, "0")}`;
    return {
      value: optionValue,
      label: formatMonthLabel(optionValue),
    };
  });
}

function getDefaultPeriodStart() {
  const now = new Date();
  now.setDate(now.getDate() - 84);
  return now.toISOString().slice(0, 10);
}

function getDefaultPeriodEnd() {
  return new Date().toISOString().slice(0, 10);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatNumber(value) {
  return new Intl.NumberFormat("es-MX").format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Sin fecha";
  return parsed.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "0%";
  }

  return `${new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: 0,
  }).format(Number(value || 0))}%`;
}

function formatDelta(current, previous, hasBase = true) {
  if (!hasBase) return "Sin base";
  const delta = Number(current || 0) - Number(previous || 0);
  if (delta === 0) return "Sin cambio";
  return `${delta > 0 ? "+" : ""}${formatNumber(delta)} vs semana previa`;
}

function normalizeOptions(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.rows)) return data.rows;
  return [];
}

function compareForecastOpportunityValues(left, right, field) {
  if (
    field === "hasNextStep" ||
    field === "isBlocked" ||
    field === "isStale" ||
    field === "isHighAmountHighRisk"
  ) {
    return Number(Boolean(left?.[field])) - Number(Boolean(right?.[field]));
  }

  if (field === "amountUsd") {
    return Number(left?.amountUsd || 0) - Number(right?.amountUsd || 0);
  }

  const leftValue = String(left?.[field] || "");
  const rightValue = String(right?.[field] || "");
  return leftValue.localeCompare(rightValue, "es", { sensitivity: "base" });
}

function getForecastSortArrow(activeField, activeDirection, field) {
  if (activeField !== field) return "↕";
  return activeDirection === "asc" ? "↑" : "↓";
}

function SummaryCard({ label, value, helper, tone = "default", onClick }) {
  const clickable = typeof onClick === "function";
  const Tag = clickable ? "button" : "article";
  return (
    <Tag
      type={clickable ? "button" : undefined}
      className={`tracking-summary-card is-${tone} ${clickable ? "is-clickable" : ""}`.trim()}
      onClick={clickable ? onClick : undefined}
    >
      <span className="tracking-summary-label">{label}</span>
      <strong className="tracking-summary-value">{value}</strong>
      <span className="tracking-summary-helper">{helper}</span>
    </Tag>
  );
}

function QuarterQuotaCard({ summary }) {
  const periodLabel = summary?.period?.label || "Sin trimestre";
  const hasPublishedQuota =
    Boolean(summary?.hasPlan) &&
    Boolean(summary?.hasPublishedVersion) &&
    summary?.quotaAmount !== null &&
    summary?.quotaAmount !== undefined;

  if (!hasPublishedQuota) {
    return (
      <SummaryCard
        label="Cuota trimestral"
        value="Sin cuota"
        helper={`${periodLabel} · Sin cuota publicada`}
        tone="alert"
      />
    );
  }

  const tone = summary?.isCovered ? "soft" : "default";
  return (
    <SummaryCard
      label="Cuota trimestral"
      value={formatCurrency(summary.quotaAmount)}
      helper={`${periodLabel} · Ganado ${formatCurrency(summary.wonAmount)} · ${formatPercent(summary.attainmentPercent)}`}
      tone={tone}
    />
  );
}

function SparkBars({ items, valueKey, formatter }) {
  const maxValue = useMemo(
    () =>
      items.reduce(
        (current, item) => Math.max(current, Number(item?.[valueKey] || 0)),
        0,
      ),
    [items, valueKey],
  );

  if (!items.length) {
    return (
      <div className="tracking-empty-state">No hay datos para este rango.</div>
    );
  }

  return (
    <div className="tracking-spark-bars">
      {items.map((item) => {
        const value = Number(item?.[valueKey] || 0);
        const width = maxValue > 0 ? Math.max(8, (value / maxValue) * 100) : 8;
        return (
          <div
            key={item.periodKey || item.stageCode || item.id}
            className="tracking-spark-row"
          >
            <span>{item.periodLabel || item.stageName || item.label}</span>
            <div className="tracking-spark-track">
              <div
                className="tracking-spark-fill"
                style={{ width: `${width}%` }}
              />
            </div>
            <strong>{formatter(value)}</strong>
          </div>
        );
      })}
    </div>
  );
}

function AttentionList({ title, items }) {
  return (
    <section className="tracking-panel">
      <div className="tracking-panel-header">
        <h3>{title}</h3>
        <span>{items.length}</span>
      </div>
      {items.length ? (
        <div className="tracking-attention-list">
          {items.map((item) => (
            <article
              key={item.id || `${item.name}-${item.accountName}`}
              className="tracking-attention-card"
            >
              <div className="tracking-attention-topline">
                <strong>{item.name || item.opportunityName}</strong>
                <span>{formatCurrency(item.amountUsd)}</span>
              </div>
              <p>{item.accountName}</p>
              <p>
                {item.stageName} · {item.sellerUserName}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <div className="tracking-empty-state">Sin elementos para revisar.</div>
      )}
    </section>
  );
}

export default function CommercialTrackingPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("overview");
  const [weekStart, setWeekStart] = useState(getCurrentWeekStart);
  const [forecastMonth, setForecastMonth] = useState(getCurrentMonth);
  const [forecastWeekStart, setForecastWeekStart] = useState("");
  const [sellerUserId, setSellerUserId] = useState("");
  const [businessLineId, setBusinessLineId] = useState("");
  const [viewMode, setViewMode] = useState("count");
  const [quickFilter, setQuickFilter] = useState("all");
  const [periodGranularity, setPeriodGranularity] = useState("week");
  const [periodFrom, setPeriodFrom] = useState(getDefaultPeriodStart);
  const [periodTo, setPeriodTo] = useState(getDefaultPeriodEnd);
  const [sellers, setSellers] = useState([]);
  const [businessLines, setBusinessLines] = useState([]);
  const [overview, setOverview] = useState(null);
  const [openData, setOpenData] = useState(null);
  const [periodData, setPeriodData] = useState(null);
  const [forecastData, setForecastData] = useState(null);
  const [forecastSort, setForecastSort] = useState(FORECAST_SORT_DEFAULT);
  const [loading, setLoading] = useState(true);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingTab, setLoadingTab] = useState(false);
  const [error, setError] = useState("");

  async function loadCatalogs() {
    try {
      const [sellerResponse, businessLineResponse] = await Promise.all([
        api.get("/api/catalogs/opportunity-seller-users"),
        api.get("/api/catalogs/opportunity-business-lines"),
      ]);
      setSellers(normalizeOptions(sellerResponse.data));
      setBusinessLines(normalizeOptions(businessLineResponse.data));
    } catch {
      setSellers([]);
      setBusinessLines([]);
    }
  }

  async function loadOverview() {
    setLoadingOverview(true);
    try {
      const response = await api.get("/api/commercial-tracking/overview", {
        params: {
          weekStart,
          sellerUserId: sellerUserId || undefined,
          businessLineId: businessLineId || undefined,
          viewMode,
        },
      });
      setOverview(response.data);
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar el resumen comercial",
        ),
      );
    } finally {
      setLoadingOverview(false);
    }
  }

  async function loadOpenData() {
    const response = await api.get(
      "/api/commercial-tracking/open-opportunities",
      {
        params: {
          weekStart,
          sellerUserId: sellerUserId || undefined,
          businessLineId: businessLineId || undefined,
          quickFilter,
        },
      },
    );
    setOpenData(response.data);
  }

  async function loadPeriodData() {
    const response = await api.get(
      "/api/commercial-tracking/opportunities-by-period",
      {
        params: {
          from: periodFrom,
          to: periodTo,
          granularity: periodGranularity,
          sellerUserId: sellerUserId || undefined,
          businessLineId: businessLineId || undefined,
          viewMode,
        },
      },
    );
    setPeriodData(response.data);
  }

  async function loadForecastData() {
    const response = await api.get(
      "/api/commercial-tracking/forecast-monthly",
      {
        params: {
          month: forecastMonth || undefined,
          weekStart: forecastWeekStart || undefined,
          sellerUserId: sellerUserId || undefined,
          businessLineId: businessLineId || undefined,
        },
      },
    );
    setForecastData(response.data);
    if (
      response.data?.meta?.month &&
      response.data.meta.month !== forecastMonth
    ) {
      setForecastMonth(response.data.meta.month);
    }
    if (
      response.data?.meta?.activeWeekStart &&
      response.data.meta.activeWeekStart !== forecastWeekStart
    ) {
      setForecastWeekStart(response.data.meta.activeWeekStart);
    }
  }

  async function reloadAll() {
    setError("");
    setLoading(true);
    // overview gestiona su propio estado; se dispara sin bloquear
    loadOverview();
    try {
      await loadCatalogs();
      setLoadingTab(true);
      try {
        if (activeTab === "open") {
          await loadOpenData();
        }
        if (activeTab === "period") {
          await loadPeriodData();
        }
        if (activeTab === "forecast") {
          await loadForecastData();
        }
      } catch (requestError) {
        setError(
          getApiErrorMessage(
            requestError,
            "No fue posible cargar el pipeline",
          ),
        );
      } finally {
        setLoadingTab(false);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let ignore = false;

    async function loadActiveTab() {
      setLoadingTab(true);
      setError("");
      try {
        if (activeTab === "open") {
          await loadOpenData();
        }
        if (activeTab === "period") {
          await loadPeriodData();
        }
        if (activeTab === "forecast") {
          await loadForecastData();
        }
      } catch (requestError) {
        if (!ignore) {
          setError(
            getApiErrorMessage(
              requestError,
              "No fue posible cargar la vista solicitada",
            ),
          );
        }
      } finally {
        if (!ignore) {
          setLoadingTab(false);
        }
      }
    }

    loadActiveTab();
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTab,
    quickFilter,
    periodGranularity,
    periodFrom,
    periodTo,
    forecastMonth,
    forecastWeekStart,
  ]);

  useEffect(() => {
    let ignore = false;

    async function refreshData() {
      setError("");
      // overview se carga en paralelo sin bloquear los tabs
      loadOverview();
      try {
        if (activeTab === "open") {
          await loadOpenData();
        }
        if (activeTab === "period") {
          await loadPeriodData();
        }
        if (activeTab === "forecast") {
          await loadForecastData();
        }
      } catch (requestError) {
        if (!ignore) {
          setError(
            getApiErrorMessage(
              requestError,
              "No fue posible actualizar el pipeline",
            ),
          );
        }
      }
    }

    refreshData();
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    weekStart,
    sellerUserId,
    businessLineId,
    viewMode,
    forecastMonth,
    forecastWeekStart,
  ]);

  const overviewSummary = overview?.summary || {};
  const overviewQuarterQuota = overview?.quarterQuota || null;
  const weekChange = overview?.weekChange || {};
  const immediateAttention = overview?.immediateAttention || {};
  const openItems = openData?.items || [];
  const periodSeries = periodData?.series || [];
  const forecastSummary = forecastData?.summary || {};
  const forecastQuarterQuota = forecastData?.quarterQuota || null;
  const forecastWeekChange = forecastData?.weekChange || {};
  const forecastOpportunities = forecastData?.forecastOpportunities || [];
  const cockpitWeekOptions = useMemo(
    () => buildCockpitWeekOptions(weekStart),
    [weekStart],
  );
  const forecastMonthOptions = useMemo(
    () => buildForecastMonthOptions(forecastMonth),
    [forecastMonth],
  );
  const forecastPipeline = useMemo(() => {
    const items = [...(forecastData?.pipelineMovement || [])];
    items.sort((left, right) => {
      const leftOrder = Number(COMMERCIAL_STAGE_ORDER[left?.stageCode] || 0);
      const rightOrder = Number(COMMERCIAL_STAGE_ORDER[right?.stageCode] || 0);
      if (rightOrder !== leftOrder) {
        return rightOrder - leftOrder;
      }

      return String(right?.stageName || "").localeCompare(
        String(left?.stageName || ""),
        "es",
        { sensitivity: "base" },
      );
    });
    return items;
  }, [forecastData?.pipelineMovement]);
  const forecastWeeks = forecastData?.meta?.validWeeks || [];
  const sortedForecastOpportunities = useMemo(() => {
    const items = [...forecastOpportunities];
    items.sort((left, right) => {
      const primary = compareForecastOpportunityValues(
        left,
        right,
        forecastSort.field,
      );
      if (primary !== 0) {
        return forecastSort.direction === "asc" ? primary : -primary;
      }

      const fallback = compareForecastOpportunityValues(
        left,
        right,
        "amountUsd",
      );
      if (fallback !== 0) {
        return forecastSort.direction === "asc" &&
          forecastSort.field === "amountUsd"
          ? fallback
          : -fallback;
      }

      return String(left?.name || "").localeCompare(String(right?.name || ""));
    });
    return items;
  }, [forecastOpportunities, forecastSort]);

  function toggleForecastSort(field) {
    setForecastSort((current) => {
      if (current.field === field) {
        return {
          field,
          direction: current.direction === "asc" ? "desc" : "asc",
        };
      }

      return {
        field,
        direction: field === "amountUsd" ? "desc" : "asc",
      };
    });
  }

  function openOpportunityFromForecast(opportunityId) {
    const normalizedOpportunityId = Number(opportunityId || 0);
    if (!normalizedOpportunityId) {
      return;
    }
    navigate(`/opportunities?edit=${normalizedOpportunityId}`);
  }

  function openDevelopmentFromForecast(item) {
    const normalizedOpportunityId = Number(item?.opportunityId || 0);
    if (!normalizedOpportunityId) {
      return;
    }
    const periodKey = getQuarterKeyForDate(item?.closeDate);
    const params = new URLSearchParams({
      opportunity: String(normalizedOpportunityId),
    });
    if (periodKey) {
      params.set("period", periodKey);
    }
    navigate(`/commercial-development?${params.toString()}`);
  }

  return (
    <section className="panel tracking-page">
      <header className="tracking-hero">
        <div className="tracking-hero-copy">
          <div className="module-title-with-icon">
            <span
              className="module-title-icon tracking-title-icon"
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="M4 18h16" />
                <path d="M7 18V9" />
                <path d="M12 18V5" />
                <path d="M17 18v-6" />
              </svg>
            </span>
            <h2 data-help-id="tracking.title">Pipeline</h2>
          </div>
          <p className="section-helper-text tracking-hero-text">
            Da visibilidad al pipeline, al forecast y a los movimientos
            semanales que empujan oportunidades abiertas y nuevas.
          </p>
        </div>

        <div className="tracking-toolbar" data-help-id="tracking.toolbar">
          {activeTab === "forecast" ? (
            <>
              <label>
                Mes
                <select
                  value={forecastMonth}
                  onChange={(event) => {
                    setForecastMonth(event.target.value);
                    setForecastWeekStart("");
                  }}
                >
                  {forecastMonthOptions.map((month) => (
                    <option key={month.value} value={month.value}>
                      {month.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Semana
                <select
                  value={forecastData?.meta?.activeWeekStart || forecastWeekStart}
                  onChange={(event) => setForecastWeekStart(event.target.value)}
                  disabled={!forecastWeeks.length}
                >
                  {forecastWeeks.map((week) => (
                    <option key={week.key} value={week.key}>
                      {week.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <label>
              Semana
              <select
                value={weekStart}
                onChange={(event) => setWeekStart(event.target.value)}
              >
                {cockpitWeekOptions.map((week) => (
                  <option key={week.value} value={week.value}>
                    {week.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Vendedor
            <select
              value={sellerUserId}
              onChange={(event) => setSellerUserId(event.target.value)}
            >
              <option value="">Todos</option>
              {sellers.map((seller) => (
                <option
                  key={seller.id || seller.value || seller.email}
                  value={seller.id || seller.value || ""}
                >
                  {seller.full_name ||
                    seller.fullName ||
                    seller.name ||
                    seller.label ||
                    "Sin nombre"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Línea
            <select
              value={businessLineId}
              onChange={(event) => setBusinessLineId(event.target.value)}
            >
              <option value="">Todas</option>
              {businessLines.map((line) => (
                <option key={line.id || line.value} value={line.id || ""}>
                  {line.name || line.label || "Sin nombre"}
                </option>
              ))}
            </select>
          </label>
          {activeTab !== "forecast" ? (
            <label>
              Vista
              <select
                value={viewMode}
                onChange={(event) => setViewMode(event.target.value)}
              >
                <option value="count">Cantidad</option>
                <option value="amount">Monto</option>
              </select>
            </label>
          ) : null}
          <button
            type="button"
            className="tracking-icon-button"
            onClick={reloadAll}
            aria-label="Actualizar lectura"
            title="Actualizar lectura"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              aria-hidden="true"
            >
              <path d="M20 12a8 8 0 1 1-2.34-5.66" />
              <path d="M20 4v6h-6" />
            </svg>
          </button>
        </div>
      </header>

      {error ? <p className="form-error">{error}</p> : null}

      <div
        data-help-id="tracking.tabs"
        className="tracking-tabs"
        role="tablist"
        aria-label="Vistas de pipeline"
      >
        {TAB_OPTIONS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tracking-tab ${activeTab === tab.id ? "is-active" : ""}`.trim()}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="tracking-empty-state">
          Cargando pipeline...
        </div>
      ) : null}

      {activeTab === "overview" ? (
        loadingOverview ? (
          <div className="tracking-empty-state">Cargando resumen...</div>
        ) : (
          <div className="tracking-layout">
            <div className="tracking-summary-grid tracking-summary-grid-overview">
              <SummaryCard
                label="Oportunidades abiertas"
                value={formatNumber(overviewSummary.openOpportunities)}
                helper="Pipeline activo hoy"
                onClick={() => {
                  setQuickFilter("all");
                  setActiveTab("open");
                }}
              />
              <SummaryCard
                label="Monto abierto"
                value={formatCurrency(overviewSummary.openAmountUsd)}
                helper="Impacto economico del pipeline"
                tone="soft"
              />
              <SummaryCard
                label="Nuevas esta semana"
                value={formatNumber(overviewSummary.newThisWeek)}
                helper={formatDelta(
                  weekChange?.newThisWeek?.current,
                  weekChange?.newThisWeek?.previous,
                )}
              />
              <SummaryCard
                label="Monto nuevo semana"
                value={formatCurrency(overviewSummary.newAmountUsd)}
                helper="Pipeline generado en la semana"
                tone="soft"
              />
              <QuarterQuotaCard summary={overviewQuarterQuota} />
              <SummaryCard
                label="Avanzadas esta semana"
                value={formatNumber(overviewSummary.advancedThisWeek)}
                helper={formatDelta(
                  weekChange?.advancedThisWeek?.current,
                  weekChange?.advancedThisWeek?.previous,
                )}
              />
              <SummaryCard
                label="Bloqueadas"
                value={formatNumber(overviewSummary.blockedOpenOpportunities)}
                helper="Requieren intervencion inmediata"
                tone="alert"
                onClick={() => {
                  setQuickFilter("blocked");
                  setActiveTab("open");
                }}
              />
            </div>

            <div className="tracking-grid-two">
              <section className="tracking-panel">
                <div className="tracking-panel-header">
                  <h3>Qué cambió esta semana</h3>
                  <span>{weekStart}</span>
                </div>
                <div className="tracking-week-change-grid">
                  <article>
                    <strong>
                      {formatNumber(weekChange?.advancedThisWeek?.current)}
                    </strong>
                    <span>Avanzadas</span>
                  </article>
                  <article>
                    <strong>
                      {formatNumber(weekChange?.wonThisWeek?.current)}
                    </strong>
                    <span>Ganadas</span>
                  </article>
                  <article>
                    <strong>
                      {formatNumber(weekChange?.lostThisWeek?.current)}
                    </strong>
                    <span>Perdidas</span>
                  </article>
                </div>
              </section>

              <section className="tracking-panel">
                <div className="tracking-panel-header">
                  <h3>Generación últimas semanas</h3>
                  <span>{viewMode === "amount" ? "Monto" : "Cantidad"}</span>
                </div>
                <SparkBars
                  items={overview?.generationTrend || []}
                  valueKey={
                    viewMode === "amount" ? "createdAmountUsd" : "createdCount"
                  }
                  formatter={
                    viewMode === "amount" ? formatCurrency : formatNumber
                  }
                />
              </section>
            </div>

            <div className="tracking-grid-two">
              <AttentionList
                title="Sin siguiente paso"
                items={immediateAttention.noNextStep || []}
              />
              <AttentionList
                title="Bloqueadas"
                items={immediateAttention.blocked || []}
              />
            </div>

            <div className="tracking-grid-two">
              <AttentionList
                title="Sin actividad reciente"
                items={immediateAttention.stale || []}
              />
              <AttentionList
                title="Alto monto y alto riesgo"
                items={immediateAttention.highAmountHighRisk || []}
              />
            </div>

            <section className="tracking-panel">
              <div className="tracking-panel-header">
                <h3>Movimiento del pipeline por etapa</h3>
                <span>{overview?.pipelineMovement?.length || 0} etapas</span>
              </div>
              <div className="tracking-table-wrap">
                <table className="tracking-table">
                  <thead>
                    <tr>
                      <th>Etapa</th>
                      <th>Abiertas</th>
                      <th>Avanzadas semana</th>
                      <th>Bloqueadas</th>
                      <th>Sin actividad</th>
                      <th>Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(overview?.pipelineMovement || []).map((item) => (
                      <tr key={item.stageCode}>
                        <td>{item.stageName}</td>
                        <td>{formatNumber(item.openCount)}</td>
                        <td>{formatNumber(item.advancedInWeek)}</td>
                        <td>{formatNumber(item.blockedCount)}</td>
                        <td>{formatNumber(item.staleCount)}</td>
                        <td>{formatCurrency(item.totalAmountUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )
      ) : null}

      {!loading && activeTab === "forecast" ? (
        <div className="tracking-layout">
          <div className="tracking-summary-grid is-forecast">
            <SummaryCard
              label="Oportunidades abiertas"
              value={formatNumber(forecastSummary.openOpportunities)}
              helper="Universo del mes objetivo"
            />
            <SummaryCard
              label="Monto abierto"
              value={formatCurrency(forecastSummary.openAmountUsd)}
              helper="Impacto económico del forecast"
              tone="soft"
            />
            <SummaryCard
              label="Avanzadas en la semana"
              value={formatNumber(forecastSummary.advancedThisWeek)}
              helper={formatDelta(
                forecastWeekChange?.advancedThisWeek?.current,
                forecastWeekChange?.advancedThisWeek?.previous,
                forecastWeekChange?.advancedThisWeek?.hasPrevious,
              )}
            />
            <SummaryCard
              label="Bloqueadas"
              value={formatNumber(forecastSummary.blockedOpenOpportunities)}
              helper="Requieren intervención inmediata"
              tone="alert"
            />
            <QuarterQuotaCard summary={forecastQuarterQuota} />
          </div>

          <section className="tracking-panel">
            <div className="tracking-panel-header tracking-panel-header-wide">
              <div>
                <h3>Oportunidades del mes</h3>
                <span>{forecastOpportunities.length} oportunidades</span>
              </div>
            </div>

            {forecastOpportunities.length ? (
              <div className="tracking-table-wrap">
                <table className="tracking-table tracking-critical-table">
                  <thead>
                    <tr>
                      <th>
                        <button
                          type="button"
                          className="tracking-table-sort"
                          onClick={() => toggleForecastSort("name")}
                        >
                          Oportunidad{" "}
                          <span>
                            {getForecastSortArrow(
                              forecastSort.field,
                              forecastSort.direction,
                              "name",
                            )}
                          </span>
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="tracking-table-sort"
                          onClick={() => toggleForecastSort("accountName")}
                        >
                          Cuenta{" "}
                          <span>
                            {getForecastSortArrow(
                              forecastSort.field,
                              forecastSort.direction,
                              "accountName",
                            )}
                          </span>
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="tracking-table-sort"
                          onClick={() => toggleForecastSort("sellerUserName")}
                        >
                          Vendedor{" "}
                          <span>
                            {getForecastSortArrow(
                              forecastSort.field,
                              forecastSort.direction,
                              "sellerUserName",
                            )}
                          </span>
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="tracking-table-sort"
                          onClick={() => toggleForecastSort("stageName")}
                        >
                          Etapa comercial{" "}
                          <span>
                            {getForecastSortArrow(
                              forecastSort.field,
                              forecastSort.direction,
                              "stageName",
                            )}
                          </span>
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="tracking-table-sort"
                          onClick={() => toggleForecastSort("amountUsd")}
                        >
                          Monto{" "}
                          <span>
                            {getForecastSortArrow(
                              forecastSort.field,
                              forecastSort.direction,
                              "amountUsd",
                            )}
                          </span>
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="tracking-table-sort"
                          onClick={() => toggleForecastSort("hasNextStep")}
                        >
                          Sin siguiente paso{" "}
                          <span>
                            {getForecastSortArrow(
                              forecastSort.field,
                              forecastSort.direction,
                              "hasNextStep",
                            )}
                          </span>
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="tracking-table-sort"
                          onClick={() => toggleForecastSort("isBlocked")}
                        >
                          Bloqueada{" "}
                          <span>
                            {getForecastSortArrow(
                              forecastSort.field,
                              forecastSort.direction,
                              "isBlocked",
                            )}
                          </span>
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="tracking-table-sort"
                          onClick={() => toggleForecastSort("isStale")}
                        >
                          Sin actividad reciente{" "}
                          <span>
                            {getForecastSortArrow(
                              forecastSort.field,
                              forecastSort.direction,
                              "isStale",
                            )}
                          </span>
                        </button>
                      </th>
                      <th>
                        <button
                          type="button"
                          className="tracking-table-sort"
                          onClick={() =>
                            toggleForecastSort("isHighAmountHighRisk")
                          }
                        >
                          Alto monto y alto riesgo{" "}
                          <span>
                            {getForecastSortArrow(
                              forecastSort.field,
                              forecastSort.direction,
                              "isHighAmountHighRisk",
                            )}
                          </span>
                        </button>
                      </th>
                      <th className="tracking-actions-header">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedForecastOpportunities.map((item) => (
                      <tr key={item.opportunityId}>
                        <td>
                          <strong>{item.name}</strong>
                        </td>
                        <td>{item.accountName}</td>
                        <td>{item.sellerUserName}</td>
                        <td>{item.stageName}</td>
                        <td>{formatCurrency(item.amountUsd)}</td>
                        <td className="tracking-boolean-cell">
                          {!item.hasNextStep ? (
                            <span
                              className="tracking-boolean-check"
                              aria-label="Sin siguiente paso"
                            >
                              ✓
                            </span>
                          ) : null}
                        </td>
                        <td className="tracking-boolean-cell">
                          {item.isBlocked ? (
                            <span
                              className="tracking-boolean-check"
                              aria-label="Bloqueada"
                            >
                              ✓
                            </span>
                          ) : null}
                        </td>
                        <td className="tracking-boolean-cell">
                          {item.isStale ? (
                            <span
                              className="tracking-boolean-check"
                              aria-label="Sin actividad reciente"
                            >
                              ✓
                            </span>
                          ) : null}
                        </td>
                        <td className="tracking-boolean-cell">
                          {item.isHighAmountHighRisk ? (
                            <span
                              className="tracking-boolean-check"
                              aria-label="Alto monto y alto riesgo"
                            >
                              ✓
                            </span>
                          ) : null}
                        </td>
                        <td className="tracking-actions-cell">
                          <details className="tracking-kebab-menu">
                            <summary
                              className="tracking-kebab-button"
                              aria-label={`Acciones de ${item.name}`}
                            >
                              ...
                            </summary>
                            <div className="tracking-kebab-dropdown">
                              <button
                                type="button"
                                onClick={() =>
                                  openOpportunityFromForecast(
                                    item.opportunityId,
                                  )
                                }
                              >
                                Ir a oportunidad
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  openDevelopmentFromForecast(item)
                                }
                              >
                                Ir a Desarrollo
                              </button>
                            </div>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="tracking-empty-state">
                Sin oportunidades para el mes seleccionado.
              </div>
            )}
          </section>

          <section className="tracking-panel">
            <div className="tracking-panel-header">
              <h3>Movimiento del pipeline por etapa</h3>
              <span>{forecastPipeline.length || 0} etapas</span>
            </div>
            <div className="tracking-table-wrap">
              <table className="tracking-table">
                <thead>
                  <tr>
                    <th>Etapa</th>
                    <th>Abiertas</th>
                    <th>Avanzadas semana</th>
                    <th>Bloqueadas</th>
                    <th>Sin actividad</th>
                    <th>Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {forecastPipeline.map((item) => (
                    <tr key={item.stageCode}>
                      <td>{item.stageName}</td>
                      <td>{formatNumber(item.openCount)}</td>
                      <td>{formatNumber(item.advancedInWeek)}</td>
                      <td>{formatNumber(item.blockedCount)}</td>
                      <td>{formatNumber(item.staleCount)}</td>
                      <td>{formatCurrency(item.totalAmountUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}

      {!loading && activeTab === "open" ? (
        <div className="tracking-layout">
          <section className="tracking-panel">
            <div className="tracking-panel-header tracking-panel-header-wide">
              <div>
                <h3>Oportunidades abiertas y movimiento semanal</h3>
                <span>{openData?.summary?.total || 0} oportunidades</span>
              </div>
              <div className="tracking-pill-row">
                {QUICK_FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`tracking-pill ${quickFilter === option.id ? "is-active" : ""}`.trim()}
                    onClick={() => setQuickFilter(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            {loadingTab ? (
              <div className="tracking-empty-state">Cargando detalle...</div>
            ) : null}
            {!loadingTab ? (
              <div className="tracking-table-wrap">
                <table className="tracking-table">
                  <thead>
                    <tr>
                      <th>Oportunidad</th>
                      <th>Cuenta</th>
                      <th>Vendedor</th>
                      <th>Etapa</th>
                      <th>Monto</th>
                      <th>Estado</th>
                      <th>Siguiente paso</th>
                      <th>Días sin actividad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openItems.map((item) => (
                      <tr key={item.id || item.opportunityId}>
                        <td>
                          <strong>{item.name || item.opportunityName}</strong>
                          {item.advancedThisWeek ? (
                            <div className="tracking-inline-note">
                              Avanzó esta semana
                            </div>
                          ) : null}
                        </td>
                        <td>{item.accountName}</td>
                        <td>{item.sellerUserName}</td>
                        <td>{item.stageName}</td>
                        <td>{formatCurrency(item.amountUsd)}</td>
                        <td>
                          <span
                            className={`tracking-state-badge is-${item.executionState?.code || item.executionStateCode || "en_curso"}`.trim()}
                          >
                            {item.executionState?.label ||
                              item.executionStateLabel ||
                              "En curso"}
                          </span>
                        </td>
                        <td>{item.nextStep?.title || "Sin siguiente paso"}</td>
                        <td>{formatNumber(item.daysSinceActivity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {!loading && activeTab === "period" ? (
        <div className="tracking-layout">
          <section className="tracking-panel">
            <div className="tracking-panel-header tracking-panel-header-wide">
              <div>
                <h3>Oportunidades por período</h3>
                <span>{periodSeries.length} cortes</span>
              </div>
              <div className="tracking-inline-filters">
                <label>
                  Granularidad
                  <select
                    value={periodGranularity}
                    onChange={(event) =>
                      setPeriodGranularity(event.target.value)
                    }
                  >
                    <option value="week">Semanal</option>
                    <option value="month">Mensual</option>
                  </select>
                </label>
                <label>
                  Desde
                  <input
                    type="date"
                    value={periodFrom}
                    onChange={(event) => setPeriodFrom(event.target.value)}
                  />
                </label>
                <label>
                  Hasta
                  <input
                    type="date"
                    value={periodTo}
                    onChange={(event) => setPeriodTo(event.target.value)}
                  />
                </label>
              </div>
            </div>
            {loadingTab ? (
              <div className="tracking-empty-state">Cargando tendencia...</div>
            ) : null}
            {!loadingTab ? (
              <>
                <SparkBars
                  items={periodSeries}
                  valueKey={
                    viewMode === "amount" ? "createdAmountUsd" : "createdCount"
                  }
                  formatter={
                    viewMode === "amount" ? formatCurrency : formatNumber
                  }
                />
                <div className="tracking-table-wrap">
                  <table className="tracking-table">
                    <thead>
                      <tr>
                        <th>Período</th>
                        <th>Creadas</th>
                        <th>Ganadas</th>
                        <th>Perdidas</th>
                        <th>Abiertas al cierre</th>
                        <th>Variación</th>
                      </tr>
                    </thead>
                    <tbody>
                      {periodSeries.map((item) => {
                        const createdValue =
                          viewMode === "amount"
                            ? item.createdAmountUsd
                            : item.createdCount;
                        const wonValue =
                          viewMode === "amount"
                            ? item.wonAmountUsd
                            : item.wonCount;
                        const lostValue =
                          viewMode === "amount"
                            ? item.lostAmountUsd
                            : item.lostCount;
                        const openValue =
                          viewMode === "amount"
                            ? item.openAtEndAmountUsd
                            : item.openAtEndCount;
                        const delta = item.deltaVsPrevious;

                        return (
                          <tr key={item.periodKey}>
                            <td>{item.periodLabel}</td>
                            <td>
                              {viewMode === "amount"
                                ? formatCurrency(createdValue)
                                : formatNumber(createdValue)}
                            </td>
                            <td>
                              {viewMode === "amount"
                                ? formatCurrency(wonValue)
                                : formatNumber(wonValue)}
                            </td>
                            <td>
                              {viewMode === "amount"
                                ? formatCurrency(lostValue)
                                : formatNumber(lostValue)}
                            </td>
                            <td>
                              {viewMode === "amount"
                                ? formatCurrency(openValue)
                                : formatNumber(openValue)}
                            </td>
                            <td>
                              {delta ? (
                                <span>
                                  {delta.deltaAbsolute > 0 ? "+" : ""}
                                  {viewMode === "amount"
                                    ? formatCurrency(delta.deltaAbsolute)
                                    : formatNumber(delta.deltaAbsolute)}
                                  {delta.deltaPercent === null
                                    ? " · sin base"
                                    : ` · ${delta.deltaPercent > 0 ? "+" : ""}${delta.deltaPercent}%`}
                                </span>
                              ) : (
                                <span>Sin base</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </section>
  );
}
