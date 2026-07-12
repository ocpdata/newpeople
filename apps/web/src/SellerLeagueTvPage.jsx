import { useEffect, useState } from "react";
import { api, getApiErrorMessage } from "./api";
import "./seller-league-tv.css";

function getUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    page: Math.max(1, Number(params.get("page")) || 1),
    debug: params.get("debug") === "true",
  };
}

const leadCountFormatter = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 0,
});

const usdCurrencyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatLeadCount(value) {
  const numericValue = Math.round(Number(value || 0));
  return leadCountFormatter.format(numericValue);
}

function formatCurrencyUsd(value) {
  return usdCurrencyFormatter.format(Number(value || 0));
}

function calculateRequiredFunnelAmountUsd(gapAmountUsd, conversionRatio) {
  const numericGapAmountUsd = Number(gapAmountUsd || 0);
  const numericConversionRatio = Number(conversionRatio || 0);

  if (numericGapAmountUsd <= 0 || numericConversionRatio <= 0) {
    return null;
  }

  return numericGapAmountUsd / numericConversionRatio;
}

function formatGaugeValue(value, { divisor = 1, maxFractionDigits = 0 } = {}) {
  const numericValue = Number(value || 0);
  const safeDivisor = Number(divisor) > 0 ? Number(divisor) : 1;
  const scaledValue = numericValue / safeDivisor;
  return new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: Math.max(0, Number(maxFractionDigits || 0)),
  }).format(scaledValue);
}

function LeadGauge({
  actual,
  target,
  maxValue,
  valueDivisor = 1,
  valueMaxFractionDigits = 0,
  valueSuffix = "",
  className = "",
}) {
  const numericTarget = Math.max(0, Number(target || 0));
  const explicitMax = Number(maxValue || 0);
  const referenceMax =
    explicitMax > 0
      ? explicitMax
      : numericTarget > 0
        ? numericTarget / 0.75
        : 0;
  const progressRatio =
    referenceMax > 0
      ? Math.max(0, Math.min(Number(actual || 0) / referenceMax, 1))
      : 0;
  const formatValue = (value) =>
    formatGaugeValue(value, {
      divisor: valueDivisor,
      maxFractionDigits: valueMaxFractionDigits,
    });
  const formattedActual = formatValue(actual);
  const formattedTarget = formatValue(target);
  const formattedMax = formatValue(referenceMax);
  const needleRotation = -90 + progressRatio * 180;
  const targetRatio =
    referenceMax > 0
      ? Math.max(0, Math.min(numericTarget / referenceMax, 1))
      : 0;
  const targetAngle = Math.PI - Math.PI * targetRatio;
  const targetRadius = 80;
  const targetCx = 120 + targetRadius * Math.cos(targetAngle);
  const targetCy = 120 - targetRadius * Math.sin(targetAngle);

  return (
    <div
      className={`seller-league-gauge ${className}`.trim()}
      aria-hidden="true"
    >
      <svg
        className="seller-league-gauge-svg"
        viewBox="0 0 240 180"
        role="presentation"
        focusable="false"
      >
        <defs>
          <linearGradient id="leadGaugeTrack" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#e5e7eb" />
            <stop offset="100%" stopColor="#cbd5e1" />
          </linearGradient>
          <linearGradient id="leadGaugeValue" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#19b7a8" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
        </defs>

        <path
          d="M 40 120 A 80 80 0 0 1 200 120"
          pathLength="100"
          className="seller-league-gauge-track"
        />
        <path
          d="M 40 120 A 80 80 0 0 1 200 120"
          pathLength="100"
          className="seller-league-gauge-value-arc"
          style={{ strokeDasharray: `${progressRatio * 100} 100` }}
        />
        <circle
          cx={targetCx}
          cy={targetCy}
          r="5"
          className="seller-league-gauge-target-dot"
        />
        <text
          x="40"
          y="153"
          className="seller-league-gauge-label seller-league-gauge-label--min"
        >
          {`0${valueSuffix}`}
        </text>
        <text
          x={targetCx}
          y={targetCy - 10}
          textAnchor="middle"
          className="seller-league-gauge-label seller-league-gauge-label--target"
        >
          {`${formattedTarget}${valueSuffix}`}
        </text>
        <text
          x="200"
          y="153"
          textAnchor="end"
          className="seller-league-gauge-label seller-league-gauge-label--max"
        >
          {`${formattedMax}${valueSuffix}`}
        </text>
        <circle cx="120" cy="120" r="10" className="seller-league-gauge-hub" />
        <line
          x1="120"
          y1="120"
          x2="120"
          y2="72"
          className="seller-league-gauge-needle"
          style={{
            transform: `rotate(${needleRotation}deg)`,
            transformOrigin: "120px 120px",
          }}
        />
        <circle
          cx="120"
          cy="120"
          r="12"
          className="seller-league-gauge-hub-outline"
        />
      </svg>

      <div className="seller-league-gauge-center">
        <strong className="seller-league-gauge-value">
          {`${formattedActual}${valueSuffix}`}
        </strong>
      </div>
    </div>
  );
}

function SellerStageFunnel({
  stages,
  totalAmountUsd,
  requiredAmountUsd = null,
}) {
  const normalizedStages = Array.isArray(stages)
    ? [...stages].sort(
        (left, right) =>
          Number(left.stageOrder ?? 9999) - Number(right.stageOrder ?? 9999),
      )
    : [];
  const numericRequiredAmountUsd = Number(requiredAmountUsd || 0);
  const numericTotalAmountUsd = Number(totalAmountUsd || 0);
  const comparisonBase = Math.max(
    numericTotalAmountUsd,
    numericRequiredAmountUsd,
    0,
  );
  const actualWidthPct =
    comparisonBase > 0 && numericTotalAmountUsd > 0
      ? Math.max((numericTotalAmountUsd / comparisonBase) * 100, 1)
      : 0;
  const requiredWidthPct =
    comparisonBase > 0 && numericRequiredAmountUsd > 0
      ? Math.max((numericRequiredAmountUsd / comparisonBase) * 100, 1)
      : 0;

  if (!normalizedStages.length || Number(totalAmountUsd || 0) <= 0) {
    return (
      <div className="seller-league-funnel-empty">Sin funnel abierto.</div>
    );
  }

  return (
    <div className="seller-league-funnel-wrap">
      {numericRequiredAmountUsd > 0 ? (
        <div className="seller-league-funnel-required">
          <div className="seller-league-funnel-required-head">
            <strong>Funnel requerido</strong>
            <span>{formatCurrencyUsd(numericRequiredAmountUsd)}</span>
          </div>
          <div className="seller-league-funnel-required-track">
            <div
              className="seller-league-funnel-required-fill"
              style={{ width: `${requiredWidthPct}%` }}
            />
          </div>
        </div>
      ) : null}
      <div className="seller-league-funnel-track-scale" aria-hidden="true">
        <div
          className="seller-league-funnel-track"
          style={{ width: `${actualWidthPct}%` }}
        >
          {normalizedStages.map((stage) => (
            <div
              key={stage.stageCode}
              className="seller-league-funnel-segment"
              style={{
                width: `${Math.max(Number(stage.stageSharePct || 0), 1)}%`,
              }}
              title={`${stage.stageName}: ${formatCurrencyUsd(stage.openAmountUsd)} (${formatLeadCount(stage.opportunityCount)} opps)`}
            />
          ))}
        </div>
      </div>
      <div className="seller-league-funnel-meta">
        <strong>{formatCurrencyUsd(totalAmountUsd)}</strong>
        <span>Monto abierto</span>
      </div>
      <div className="seller-league-funnel-legend">
        {normalizedStages.slice(0, 4).map((stage) => (
          <span key={`legend-${stage.stageCode}`}>
            {stage.stageName} · {formatLeadCount(stage.opportunityCount)}
          </span>
        ))}
      </div>
    </div>
  );
}

function LeadsAssignedWeeklyChart({
  series,
  variantClassName = "",
  yAxisLabel = "Días",
}) {
  const safeSeries = Array.isArray(series)
    ? series
        .slice(-10)
        .map((value) =>
          value === null || value === undefined
            ? null
            : Math.max(0, Number(value || 0)),
        )
    : [];
  const normalizedSeries =
    safeSeries.length === 10
      ? safeSeries
      : Array.from({ length: 10 }, (_, index) => safeSeries[index] ?? null);

  const width = 240;
  const height = 120;
  const padding = { top: 8, right: 10, bottom: 26, left: 30 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const numericValues = normalizedSeries.filter((value) => value !== null);
  const yMaxRaw = Math.max(...numericValues, 1);
  const yMax = Math.ceil(yMaxRaw / 5) * 5;

  const points = normalizedSeries.map((value, index) => {
    const x =
      padding.left +
      (innerWidth * index) / Math.max(normalizedSeries.length - 1, 1);
    const y =
      value === null
        ? null
        : padding.top + innerHeight - (value / yMax) * innerHeight;
    return { x, y, value };
  });

  const linePath = points.reduce((path, point) => {
    if (point.y === null) {
      return path;
    }
    if (!path.length || path.endsWith("Z")) {
      return `${path}${path.length ? " " : ""}M ${point.x} ${point.y}`;
    }
    return `${path} L ${point.x} ${point.y}`;
  }, "");

  const yTicks = [0, Math.round(yMax / 2), yMax];

  return (
    <div
      className={`seller-detail-line-chart-wrap ${variantClassName}`.trim()}
      aria-hidden="true"
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="seller-detail-line-chart"
        role="presentation"
        focusable="false"
      >
        <line
          x1={padding.left}
          y1={padding.top + innerHeight}
          x2={padding.left + innerWidth}
          y2={padding.top + innerHeight}
          className="seller-detail-line-chart-axis"
        />
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={padding.top + innerHeight}
          className="seller-detail-line-chart-axis"
        />

        {yTicks.map((tick) => {
          const y = padding.top + innerHeight - (tick / yMax) * innerHeight;
          return (
            <g key={`tick-${tick}`}>
              <line
                x1={padding.left}
                y1={y}
                x2={padding.left + innerWidth}
                y2={y}
                className="seller-detail-line-chart-grid"
              />
              <text
                x={padding.left - 6}
                y={y + 4}
                textAnchor="end"
                className="seller-detail-line-chart-label"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {linePath ? (
          <path d={linePath} className="seller-detail-line-chart-series" />
        ) : null}

        {points.map((point, index) =>
          point.y === null ? null : (
            <circle
              key={`point-${index}`}
              cx={point.x}
              cy={point.y}
              r="2.4"
              className="seller-detail-line-chart-point"
            />
          ),
        )}

        <text
          x={padding.left + innerWidth / 2}
          y={height - 4}
          textAnchor="middle"
          className="seller-detail-line-chart-axis-title"
        >
          Semana
        </text>

        <text
          x={10}
          y={padding.top + innerHeight / 2}
          textAnchor="middle"
          transform={`rotate(-90 10 ${padding.top + innerHeight / 2})`}
          className="seller-detail-line-chart-axis-title"
        >
          {yAxisLabel}
        </text>

        {Array.from({ length: 10 }, (_, index) => {
          const x = padding.left + (innerWidth * index) / Math.max(10 - 1, 1);
          return (
            <text
              key={`week-label-${index + 1}`}
              x={x}
              y={padding.top + innerHeight + 14}
              textAnchor={
                index === 0 ? "start" : index === 9 ? "end" : "middle"
              }
              className="seller-detail-line-chart-label seller-detail-line-chart-label--x"
            >
              {`S${index + 1}`}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function getCurrentWeekCount(series) {
  if (!Array.isArray(series)) {
    return 0;
  }

  const currentWeekValue = Number(series[series.length - 1]);
  return Number.isFinite(currentWeekValue) && currentWeekValue >= 0
    ? currentWeekValue
    : 0;
}

function normalizeConversionPctValue(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return 0;
  }

  // Accept both ratio scale (0..1) and percentage scale (0..100).
  return numericValue <= 1 ? numericValue * 100 : numericValue;
}

function normalizeWeeklyCountSeries(series) {
  const safeSeries = Array.isArray(series)
    ? series.slice(-10).map((value) => {
        const numericValue = Number(value);
        return Number.isFinite(numericValue) && numericValue > 0
          ? numericValue
          : 0;
      })
    : [];

  return safeSeries.length === 10
    ? safeSeries
    : Array.from({ length: 10 }, (_, index) => safeSeries[index] ?? 0);
}

function SellerDetailPage({ seller, onNavigate }) {
  if (!seller) {
    return (
      <section className="seller-detail-page seller-league-page--fullscreen">
        <div className="seller-detail-content">
          <p style={{ textAlign: "center", color: "#888", marginTop: "2rem" }}>
            Vendedor no encontrado
          </p>
        </div>
      </section>
    );
  }

  const opportunitiesPerWeekActual = getCurrentWeekCount(
    seller.opportunitiesPerWeekWeeklyCounts,
  );
  const leadsPerWeekActual = getCurrentWeekCount(
    seller.leadsPerWeekWeeklyCounts,
  );
  const leadToOpportunityWeeklyConversionPct = Array.isArray(
    seller.leadToOpportunityWeeklyConversionPct,
  )
    ? seller.leadToOpportunityWeeklyConversionPct.map(
        normalizeConversionPctValue,
      )
    : [];
  const opportunityToWinWeeklyConversionPctRaw = Array.isArray(
    seller.opportunityToWinWeeklyConversionPct,
  )
    ? seller.opportunityToWinWeeklyConversionPct.map(
        normalizeConversionPctValue,
      )
    : [];
  const opportunityToWinWeeklyConversionPct =
    opportunityToWinWeeklyConversionPctRaw.length === 10
      ? opportunityToWinWeeklyConversionPctRaw
      : Array.from(
          { length: 10 },
          (_, index) => opportunityToWinWeeklyConversionPctRaw[index] ?? 0,
        );
  const leadsPerWeekSeries = normalizeWeeklyCountSeries(
    seller.leadsPerWeekWeeklyCounts,
  );
  const opportunitiesPerWeekSeries = normalizeWeeklyCountSeries(
    seller.opportunitiesPerWeekWeeklyCounts,
  );
  const leadToOpportunityCurrentWeekPct = getCurrentWeekCount(
    leadToOpportunityWeeklyConversionPct,
  );
  const leadToOpportunityCurrentWeekRatio =
    leadToOpportunityCurrentWeekPct > 0
      ? leadToOpportunityCurrentWeekPct / 100
      : 0;
  const funnelRequiredAmountUsd = calculateRequiredFunnelAmountUsd(
    seller.gapAmountUsd,
    seller.opportunityToWinCurrentRatio,
  );
  return (
    <section className="seller-detail-page seller-league-page--fullscreen">
      <div className="seller-detail-header">
        <h1 className="seller-detail-name">{seller.sellerUserName}</h1>
        <p className="seller-detail-meta">
          Ventas: {seller.salesScorePercentage || 0}% | Pipeline:{" "}
          {seller.pipelineScorePercentage || 0}% | Cumplimiento:{" "}
          {seller.complianceScorePercentage || 0}%
        </p>
      </div>

      <div className="seller-detail-sections">
        {/* Pipeline para siguiente Q */}
        <section className="seller-detail-section">
          <div className="seller-detail-section-header">
            <h2 className="seller-detail-section-title">
              Pipeline para siguiente Q
            </h2>
          </div>

          <div className="seller-detail-metrics-grid seller-detail-metrics-grid--pipeline">
            <article className="seller-detail-metric-card seller-detail-metric-card--opportunities-compact">
              <div className="seller-detail-metric-card-head">
                <span className="seller-detail-metric-card-title">Leads/Q</span>
              </div>
              <div className="seller-detail-gauge-wrap">
                <LeadGauge
                  actual={seller.leadActualCount}
                  target={seller.leadTargetCount}
                />
              </div>
            </article>

            <article className="seller-detail-metric-card">
              <div className="seller-detail-metric-card-head">
                <span className="seller-detail-metric-card-title">
                  Oportunidades/Q
                </span>
              </div>
              <div className="seller-detail-gauge-wrap">
                <LeadGauge
                  actual={seller.opportunityCreatedActualCount}
                  target={seller.opportunityCreatedTargetCount}
                />
              </div>
            </article>

            <article className="seller-detail-metric-card">
              <div className="seller-detail-metric-card-head">
                <span className="seller-detail-metric-card-title">
                  Conversión L→O %
                </span>
              </div>
              <div className="seller-detail-gauge-wrap">
                <LeadGauge
                  actual={Number(
                    seller.leadToOpportunityDisplayRatio ??
                      seller.leadToOpportunityCurrentRatio ??
                      0,
                  )}
                  target={0.5}
                  maxValue={1}
                  valueDivisor={0.01}
                  valueMaxFractionDigits={0}
                  className="seller-league-gauge--conversion"
                />
              </div>
              <LeadsAssignedWeeklyChart
                variantClassName="seller-detail-line-chart-wrap--opportunities"
                yAxisLabel="Conversión %"
                series={leadToOpportunityWeeklyConversionPct}
              />
            </article>

            <article className="seller-detail-metric-card">
              <div className="seller-detail-metric-card-head">
                <span className="seller-detail-metric-card-title">
                  Ticket promedio venta
                </span>
              </div>
              <div className="seller-detail-ticket-value-wrap">
                <strong className="seller-detail-ticket-value">
                  {formatCurrencyUsd(seller.averageSaleTicketAmount)}
                </strong>
                <span className="seller-detail-ticket-meta">US$ por venta</span>
              </div>
            </article>

            <article className="seller-detail-metric-card">
              <div className="seller-detail-metric-card-head">
                <span className="seller-detail-metric-card-title">
                  Leads/Semana
                </span>
              </div>
              <div className="seller-detail-gauge-wrap">
                <LeadGauge
                  actual={leadsPerWeekActual}
                  target={Math.round((seller.leadTargetCount || 0) / 13)}
                />
              </div>
              <LeadsAssignedWeeklyChart
                variantClassName="seller-detail-line-chart-wrap--opportunities"
                yAxisLabel="Leads"
                series={leadsPerWeekSeries}
              />
            </article>

            <article className="seller-detail-metric-card">
              <div className="seller-detail-metric-card-head">
                <span className="seller-detail-metric-card-title">
                  Oportunidades/Semana
                </span>
              </div>
              <div className="seller-detail-gauge-wrap">
                <LeadGauge
                  actual={opportunitiesPerWeekActual}
                  target={Math.round(
                    (seller.opportunityCreatedTargetCount || 0) / 13,
                  )}
                />
              </div>
              <LeadsAssignedWeeklyChart
                variantClassName="seller-detail-line-chart-wrap--opportunities"
                yAxisLabel="Oportunidades"
                series={opportunitiesPerWeekSeries}
              />
            </article>

            <article className="seller-detail-metric-card seller-detail-metric-card--otv-compact">
              <div className="seller-detail-metric-card-head">
                <span className="seller-detail-metric-card-title">
                  Tiempo O→V
                </span>
              </div>
              <div className="seller-detail-metric-value-wrap">
                <strong className="seller-detail-metric-value">
                  {seller.opportunityToWinDays || 0}
                </strong>
                <span className="seller-detail-metric-unit">días</span>
              </div>
              <LeadsAssignedWeeklyChart
                variantClassName="seller-detail-line-chart-wrap--otv"
                series={seller.opportunityToWinWeeklyDays || []}
              />
            </article>

            <article className="seller-detail-metric-card seller-detail-metric-card--lto-compact">
              <div className="seller-detail-metric-card-head">
                <span className="seller-detail-metric-card-title">
                  Tiempo L→O
                </span>
              </div>
              <div className="seller-detail-metric-value-wrap">
                <strong className="seller-detail-metric-value">
                  {seller.leadToOpportunityDays || 0}
                </strong>
                <span className="seller-detail-metric-unit">días</span>
              </div>
              <LeadsAssignedWeeklyChart
                variantClassName="seller-detail-line-chart-wrap--lto"
                series={seller.leadToOpportunityWeeklyDays || []}
              />
            </article>

            <article className="seller-detail-metric-card seller-detail-metric-card--leads-assigned-compact">
              <div className="seller-detail-metric-card-head">
                <span className="seller-detail-metric-card-title">
                  Tiempo Leads sin calificar
                </span>
              </div>
              <div className="seller-detail-metric-value-wrap">
                <strong className="seller-detail-metric-value">
                  {seller.leadsAssignedDays || 0}
                </strong>
                <span className="seller-detail-metric-unit">días</span>
              </div>
              <LeadsAssignedWeeklyChart
                series={seller.leadsAssignedWeeklyDays || []}
              />
            </article>
          </div>
        </section>

        {/* Cumplimiento Q actual */}
        <section className="seller-detail-section">
          <div className="seller-detail-section-header">
            <h2 className="seller-detail-section-title">
              Cumplimiento Q actual
            </h2>
          </div>

          <div className="seller-detail-metrics-grid seller-detail-metrics-grid--compliance">
            <article className="seller-detail-metric-card">
              <div className="seller-detail-metric-card-head">
                <span className="seller-detail-metric-card-title">
                  Cuota (M US$)
                </span>
              </div>
              <div className="seller-detail-gauge-wrap">
                <LeadGauge
                  actual={seller.wonAmountUsd}
                  target={seller.quotaAmountUsd}
                  valueDivisor={1000000}
                  valueMaxFractionDigits={2}
                />
              </div>
            </article>

            <article className="seller-detail-metric-card">
              <div className="seller-detail-metric-card-head">
                <span className="seller-detail-metric-card-title">
                  Conversión O→V %
                </span>
              </div>
              <div className="seller-detail-gauge-wrap">
                <LeadGauge
                  actual={Number(seller.opportunityToWinCurrentRatio ?? 0)}
                  target={Number(seller.opportunityToWinConfiguredRatio || 0)}
                  maxValue={1}
                  valueDivisor={0.01}
                  valueMaxFractionDigits={0}
                  className="seller-league-gauge--conversion"
                />
              </div>
              <LeadsAssignedWeeklyChart
                variantClassName="seller-detail-line-chart-wrap--opportunities"
                yAxisLabel="Conversión %"
                series={opportunityToWinWeeklyConversionPct}
              />
            </article>

            <article className="seller-detail-metric-card seller-detail-metric-card--full">
              <div className="seller-detail-metric-card-head">
                <span className="seller-detail-metric-card-title">
                  Funnel por etapa
                </span>
              </div>
              <SellerStageFunnel
                stages={seller.funnelByStage}
                totalAmountUsd={seller.funnelOpenAmountUsd}
                requiredAmountUsd={funnelRequiredAmountUsd}
              />
            </article>
          </div>
        </section>
      </div>
    </section>
  );
}

export default function SellerLeagueTvPage() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [isDebugMode, setIsDebugMode] = useState(false);

  async function loadDashboard() {
    try {
      const { data } = await api.get(
        "/api/commercial-tracking/seller-league-tv",
      );
      setPayload(data || null);
      setError("");
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar el ritmo comercial",
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();

    const refreshId = window.setInterval(
      () => {
        loadDashboard();
      },
      5 * 60 * 1000,
    );

    return () => {
      window.clearInterval(refreshId);
    };
  }, []);

  // Initialize from URL parameters
  useEffect(() => {
    const { page, debug } = getUrlParams();
    setCurrentPage(page);
    setIsDebugMode(debug);
  }, []);

  // Auto-rotation timer
  useEffect(() => {
    if (isDebugMode || !payload?.leaderboard?.length) return;

    const maxPage = Math.max(1, (payload?.leaderboard?.length || 1) + 1);
    const rotationId = window.setInterval(() => {
      setCurrentPage((prev) => {
        const next = prev >= maxPage ? 1 : prev + 1;
        window.history.replaceState(null, "", `?page=${next}`);
        return next;
      });
    }, 60 * 1000);

    return () => {
      window.clearInterval(rotationId);
    };
  }, [isDebugMode, payload?.leaderboard?.length]);

  function handleNavigate(direction) {
    const maxPage = Math.max(1, (leaderboard?.length || 1) + 1);
    let nextPage = currentPage + direction;
    if (nextPage < 1) nextPage = maxPage;
    if (nextPage > maxPage) nextPage = 1;
    setCurrentPage(nextPage);
    window.history.replaceState(null, "", `?page=${nextPage}&debug=true`);
  }

  const leaderboard = Array.isArray(payload?.leaderboard)
    ? payload.leaderboard
    : [];
  const sellerCount = Math.max(leaderboard.length, 1);
  const gridColumns = Math.max(1, Math.ceil(Math.sqrt(sellerCount)));
  const gridRows = Math.max(1, Math.ceil(sellerCount / gridColumns));

  const maxPage = Math.max(1, (leaderboard?.length || 0) + 1);
  const sellerIndex = currentPage > 1 ? currentPage - 2 : -1;
  const currentSeller = sellerIndex >= 0 ? leaderboard[sellerIndex] : null;
  const sellerRequiredFunnelAmountUsd = (row) =>
    calculateRequiredFunnelAmountUsd(
      row?.gapAmountUsd,
      row?.opportunityToWinCurrentRatio,
    );

  return (
    <>
      <div className="seller-league-debug-navbar">
        <button
          className="seller-league-debug-btn"
          onClick={() => handleNavigate(-1)}
        >
          ← Anterior
        </button>
        <div className="seller-league-debug-info">
          Página {currentPage}/{maxPage}
        </div>
        <button
          className="seller-league-debug-btn"
          onClick={() => handleNavigate(1)}
        >
          Siguiente →
        </button>
      </div>

      {currentPage === 1 ? (
        <section
          className="seller-league-page seller-league-page--fullscreen"
          style={{
            "--seller-count": sellerCount,
            "--seller-columns": gridColumns,
            "--seller-rows": gridRows,
          }}
        >
          {error ? <p className="form-error">{error}</p> : null}

          {loading ? (
            <div className="seller-league-empty">
              Cargando ritmo comercial...
            </div>
          ) : null}

          {!loading && !leaderboard.length ? (
            <div className="seller-league-empty">
              No hay vendedores disponibles para mostrar.
            </div>
          ) : null}

          {!loading
            ? leaderboard.map((row) => (
                <section
                  key={row.sellerUserId || row.sellerUserName}
                  className="seller-league-seller-section"
                >
                  <div className="seller-league-seller-card">
                    <div className="seller-league-seller-name-wrap">
                      <h2 className="seller-league-seller-name">
                        {row.sellerUserName || "Vendedor sin nombre"}
                      </h2>
                    </div>

                    <div className="seller-league-seller-panels">
                      <section className="seller-league-panel">
                        <div className="seller-league-panel-header">
                          <h3 className="seller-league-panel-title">
                            Pipeline siguiente Q
                          </h3>
                        </div>

                        <div className="seller-league-metrics-grid seller-league-metrics-grid--pipeline">
                          <article className="seller-league-metric-card seller-league-metric-card--wide">
                            <div className="seller-league-metric-card-head">
                              <span className="seller-league-metric-card-title">
                                Leads
                              </span>
                            </div>

                            <div className="seller-league-gauge-wrap">
                              <LeadGauge
                                actual={row.leadActualCount}
                                target={row.leadTargetCount}
                              />
                            </div>
                          </article>

                          <article className="seller-league-metric-card seller-league-metric-card--wide">
                            <div className="seller-league-metric-card-head">
                              <span className="seller-league-metric-card-title">
                                Oportunidades
                              </span>
                            </div>

                            <div className="seller-league-gauge-wrap">
                              <LeadGauge
                                actual={row.opportunityCreatedActualCount}
                                target={row.opportunityCreatedTargetCount}
                              />
                            </div>
                          </article>

                          <article className="seller-league-metric-card seller-league-metric-card--wide">
                            <div className="seller-league-metric-card-head">
                              <span className="seller-league-metric-card-title">
                                Conversión L→O %
                              </span>
                            </div>

                            <div className="seller-league-gauge-wrap">
                              <LeadGauge
                                actual={
                                  Math.ceil(
                                    Number(
                                      row.leadToOpportunityDisplayRatio ??
                                        row.leadToOpportunityCurrentRatio ??
                                        0,
                                    ) * 100,
                                  ) / 100
                                }
                                target={0.5}
                                maxValue={1}
                                valueDivisor={0.01}
                                valueMaxFractionDigits={0}
                                className="seller-league-gauge--conversion"
                              />
                            </div>
                          </article>

                          <article className="seller-league-metric-card seller-league-metric-card--wide">
                            <div className="seller-league-metric-card-head">
                              <span className="seller-league-metric-card-title">
                                Ticket promedio venta
                              </span>
                            </div>

                            <div className="seller-league-ticket-value-wrap">
                              <strong className="seller-league-ticket-value">
                                {formatCurrencyUsd(row.averageSaleTicketAmount)}
                              </strong>
                              <span className="seller-league-ticket-meta">
                                US$ por venta
                              </span>
                            </div>
                          </article>
                        </div>
                      </section>

                      <section className="seller-league-panel">
                        <div className="seller-league-panel-header">
                          <h3 className="seller-league-panel-title">
                            Cumplimiento Q actual
                          </h3>
                        </div>
                        <div className="seller-league-metrics-grid seller-league-metrics-grid--compliance">
                          <article className="seller-league-metric-card seller-league-metric-card--wide">
                            <div className="seller-league-metric-card-head">
                              <span className="seller-league-metric-card-title">
                                Cuota (M US$)
                              </span>
                            </div>

                            <div className="seller-league-gauge-wrap">
                              <LeadGauge
                                actual={row.wonAmountUsd}
                                target={row.quotaAmountUsd}
                                valueDivisor={1000000}
                                valueMaxFractionDigits={2}
                              />
                            </div>
                          </article>

                          <article className="seller-league-metric-card seller-league-metric-card--wide">
                            <div className="seller-league-metric-card-head">
                              <span className="seller-league-metric-card-title">
                                Conversión O→V %
                              </span>
                            </div>

                            <div className="seller-league-gauge-wrap">
                              <LeadGauge
                                actual={
                                  Math.ceil(
                                    Number(
                                      row.opportunityToWinEffectiveRatio ??
                                        row.opportunityToWinCurrentRatio ??
                                        0,
                                    ) * 100,
                                  ) / 100
                                }
                                target={Number(
                                  row.opportunityToWinConfiguredRatio || 0,
                                )}
                                maxValue={1}
                                valueDivisor={0.01}
                                valueMaxFractionDigits={0}
                                className="seller-league-gauge--conversion"
                              />
                            </div>
                          </article>

                          <article className="seller-league-metric-card seller-league-metric-card--wide seller-league-metric-card--full">
                            <div className="seller-league-metric-card-head">
                              <span className="seller-league-metric-card-title">
                                Funnel por etapa
                              </span>
                            </div>
                            <SellerStageFunnel
                              stages={row.funnelByStage}
                              totalAmountUsd={row.funnelOpenAmountUsd}
                              requiredAmountUsd={sellerRequiredFunnelAmountUsd(
                                row,
                              )}
                            />
                          </article>
                        </div>
                      </section>
                    </div>
                  </div>
                </section>
              ))
            : null}
        </section>
      ) : (
        <SellerDetailPage seller={currentSeller} onNavigate={handleNavigate} />
      )}
    </>
  );
}
