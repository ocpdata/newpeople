import { useEffect, useState } from "react";
import { api, getApiErrorMessage } from "./api";
import "./seller-league-tv.css";

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

function SellerStageFunnel({ stages, totalAmountUsd }) {
  const normalizedStages = Array.isArray(stages)
    ? [...stages].sort(
        (left, right) =>
          Number(left.stageOrder ?? 9999) - Number(right.stageOrder ?? 9999),
      )
    : [];

  if (!normalizedStages.length || Number(totalAmountUsd || 0) <= 0) {
    return <div className="seller-league-funnel-empty">Sin funnel abierto.</div>;
  }

  return (
    <div className="seller-league-funnel-wrap">
      <div className="seller-league-funnel-track" aria-hidden="true">
        {normalizedStages.map((stage) => (
          <div
            key={stage.stageCode}
            className="seller-league-funnel-segment"
            style={{ width: `${Math.max(Number(stage.stageSharePct || 0), 1)}%` }}
            title={`${stage.stageName}: ${formatCurrencyUsd(stage.openAmountUsd)} (${formatLeadCount(stage.opportunityCount)} opps)`}
          />
        ))}
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

export default function SellerLeagueTvPage() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  const leaderboard = Array.isArray(payload?.leaderboard)
    ? payload.leaderboard
    : [];
  const sellerCount = Math.max(leaderboard.length, 1);
  const gridColumns = Math.max(1, Math.ceil(Math.sqrt(sellerCount)));
  const gridRows = Math.max(1, Math.ceil(sellerCount / gridColumns));

  return (
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
        <div className="seller-league-empty">Cargando ritmo comercial...</div>
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
                                ) *
                                  100,
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
                            target={
                              Number(row.opportunityToWinConfiguredRatio || 0)
                            }
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
  );
}
