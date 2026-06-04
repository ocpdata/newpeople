import { useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "./api";
import "./commercial-tracking.css";

const TAB_OPTIONS = [
  { id: "overview", label: "Resumen" },
  { id: "open", label: "Abiertas" },
  { id: "period", label: "Oportunidades por periodo" },
  { id: "forecast", label: "Forecast mensual" },
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

function getCurrentWeekStart() {
  const now = new Date();
  const day = now.getDay() || 7;
  if (day !== 1) {
    now.setDate(now.getDate() - (day - 1));
  }
  now.setHours(0, 0, 0, 0);
  return now.toISOString().slice(0, 10);
}

function getCurrentMonth() {
  return new Date().toISOString().slice(0, 7);
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
  const [loading, setLoading] = useState(true);
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
    const response = await api.get("/api/commercial-tracking/overview", {
      params: {
        weekStart,
        sellerUserId: sellerUserId || undefined,
        businessLineId: businessLineId || undefined,
        viewMode,
      },
    });
    setOverview(response.data);
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
          viewMode,
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
    try {
      await Promise.all([loadCatalogs(), loadOverview()]);
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
          "No fue posible cargar el seguimiento comercial",
        ),
      );
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
      try {
        await loadOverview();
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
              "No fue posible actualizar el seguimiento comercial",
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
  const weekChange = overview?.weekChange || {};
  const immediateAttention = overview?.immediateAttention || {};
  const openItems = openData?.items || [];
  const periodSeries = periodData?.series || [];
  const forecastSummary = forecastData?.summary || {};
  const forecastWeekChange = forecastData?.weekChange || {};
  const forecastAttention = forecastData?.immediateAttention || {};
  const forecastSeries = forecastData?.generationTrend || [];
  const forecastPipeline = forecastData?.pipelineMovement || [];
  const forecastWeeks = forecastData?.meta?.validWeeks || [];
  const forecastActiveWeekStart =
    forecastData?.meta?.activeWeekStart || forecastWeekStart;

  return (
    <section className="panel tracking-page">
      <header className="tracking-hero">
        <div className="tracking-hero-copy">
          <span className="tracking-kicker">Cockpit comercial</span>
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
            <h2>Seguimiento comercial</h2>
          </div>
          <p className="section-helper-text tracking-hero-text">
            Da visibilidad al pipeline, al forecast y a los movimientos
            semanales que empujan oportunidades abiertas y nuevas.
          </p>
        </div>

        <div className="tracking-toolbar">
          <label>
            Semana
            <input
              type="date"
              value={weekStart}
              onChange={(event) => setWeekStart(event.target.value)}
            />
          </label>
          <label>
            Vendedor
            <select
              value={sellerUserId}
              onChange={(event) => setSellerUserId(event.target.value)}
            >
              <option value="">Todos</option>
              {sellers.map((seller) => (
                <option
                  key={seller.id || seller.userId || seller.value}
                  value={seller.id || seller.userId || ""}
                >
                  {seller.fullName ||
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
          <button
            type="button"
            className="secondary-button"
            onClick={reloadAll}
          >
            Actualizar lectura
          </button>
        </div>
      </header>

      {error ? <p className="form-error">{error}</p> : null}

      <div
        className="tracking-tabs"
        role="tablist"
        aria-label="Vistas de seguimiento comercial"
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
          Cargando seguimiento comercial...
        </div>
      ) : null}

      {!loading && activeTab === "overview" ? (
        <div className="tracking-layout">
          <div className="tracking-summary-grid">
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
                    {formatNumber(weekChange?.newThisWeek?.current)}
                  </strong>
                  <span>Nuevas</span>
                </article>
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
      ) : null}

      {!loading && activeTab === "forecast" ? (
        <div className="tracking-layout">
          <section className="tracking-panel">
            <div className="tracking-panel-header tracking-panel-header-wide">
              <div>
                <h3>Forecast mensual</h3>
                <span>
                  {forecastData?.meta?.monthStart &&
                  forecastData?.meta?.monthEnd
                    ? `${formatDate(forecastData.meta.monthStart)} - ${formatDate(forecastData.meta.monthEnd)}`
                    : forecastMonth}
                </span>
              </div>
              <div className="tracking-inline-filters">
                <label>
                  Mes
                  <input
                    type="month"
                    value={forecastMonth}
                    onChange={(event) => {
                      setForecastMonth(event.target.value);
                      setForecastWeekStart("");
                    }}
                  />
                </label>
                <label>
                  Semana
                  <select
                    value={forecastActiveWeekStart}
                    onChange={(event) =>
                      setForecastWeekStart(event.target.value)
                    }
                    disabled={!forecastWeeks.length}
                  >
                    {forecastWeeks.map((week) => (
                      <option key={week.key} value={week.key}>
                        {week.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <p className="tracking-inline-note">
              El forecast mensual filtra por fecha objetivo de cierre y mantiene
              la lectura semanal dentro del mes seleccionado.
            </p>
          </section>

          <div className="tracking-summary-grid">
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
          </div>

          <div className="tracking-grid-two">
            <section className="tracking-panel">
              <div className="tracking-panel-header">
                <h3>Qué cambió en la semana</h3>
                <span>{forecastActiveWeekStart || forecastMonth}</span>
              </div>
              <div className="tracking-week-change-grid">
                <article>
                  <strong>
                    {formatNumber(forecastWeekChange?.newThisWeek?.current)}
                  </strong>
                  <span>Nuevas</span>
                </article>
                <article>
                  <strong>
                    {formatNumber(
                      forecastWeekChange?.advancedThisWeek?.current,
                    )}
                  </strong>
                  <span>Avanzadas</span>
                </article>
                <article>
                  <strong>
                    {formatNumber(forecastWeekChange?.wonThisWeek?.current)}
                  </strong>
                  <span>Ganadas</span>
                </article>
                <article>
                  <strong>
                    {formatNumber(forecastWeekChange?.lostThisWeek?.current)}
                  </strong>
                  <span>Perdidas</span>
                </article>
              </div>
            </section>

            <section className="tracking-panel">
              <div className="tracking-panel-header">
                <h3>Generación semanal del forecast</h3>
                <span>{viewMode === "amount" ? "Monto" : "Cantidad"}</span>
              </div>
              <SparkBars
                items={forecastSeries}
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
              items={forecastAttention.noNextStep || []}
            />
            <AttentionList
              title="Bloqueadas"
              items={forecastAttention.blocked || []}
            />
          </div>

          <div className="tracking-grid-two">
            <AttentionList
              title="Sin actividad reciente"
              items={forecastAttention.stale || []}
            />
            <AttentionList
              title="Alto monto y alto riesgo"
              items={forecastAttention.highAmountHighRisk || []}
            />
          </div>

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
                                  {delta.absolute > 0 ? "+" : ""}
                                  {viewMode === "amount"
                                    ? formatCurrency(delta.absolute)
                                    : formatNumber(delta.absolute)}
                                  {delta.percent === null
                                    ? " · sin base"
                                    : ` · ${delta.percent > 0 ? "+" : ""}${delta.percent}%`}
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
