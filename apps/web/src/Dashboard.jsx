import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getApiErrorMessage } from "./api";

function getCurrentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function buildMonthOptions(activeMonth) {
  const base = activeMonth ? new Date(`${activeMonth}-01T00:00:00`) : new Date();
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(base.getFullYear(), base.getMonth() - 2 + index, 1);
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const label = new Intl.DateTimeFormat("es-MX", {
      month: "long",
      year: "numeric",
    }).format(date);
    return {
      value,
      label: label.charAt(0).toUpperCase() + label.slice(1),
    };
  });
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatPercent(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${Number(value).toFixed(digits)}%`;
}

function formatRatio(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  return `${Number(value).toFixed(2)}x`;
}

function clampWidth(value, total) {
  if (!total || total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min((Number(value || 0) / total) * 100, 100));
}

function buildCompositionSegments(dashboardMonthly) {
  const quota = Number(dashboardMonthly?.quota?.monthAmount || 0);
  const realWon = Number(dashboardMonthly?.headline?.realWonAmount || 0);
  const committed = Number(
    dashboardMonthly?.forecastBuckets?.committed?.amountUsd || 0,
  );
  const probable = Number(
    dashboardMonthly?.forecastBuckets?.probable?.amountUsd || 0,
  );
  const weak = Number(dashboardMonthly?.forecastBuckets?.weak?.amountUsd || 0);
  const gap = Number(dashboardMonthly?.headline?.gapAmount || 0);
  const maxValue = Math.max(quota, realWon + committed + probable + weak, 1);

  return [
    { key: "real", label: "Ganado", value: realWon, tone: "success" },
    {
      key: "committed",
      label: "Muy probable",
      value: committed,
      tone: "accent",
    },
    {
      key: "probable",
      label: "En seguimiento",
      value: probable,
      tone: "warning",
    },
    { key: "weak", label: "Riesgoso", value: weak, tone: "muted" },
    { key: "gap", label: "Falta por cubrir", value: gap, tone: "danger" },
  ].map((segment) => ({
    ...segment,
    width: clampWidth(segment.value, maxValue),
  }));
}

function DashboardMetricCard({ label, value, helper, description, tone = "default" }) {
  return (
    <article className={`dashboard-monthly-metric is-${tone}`.trim()}>
      <span className="dashboard-monthly-metric-label">{label}</span>
      <strong className="dashboard-monthly-metric-value">{value}</strong>
      {helper ? <span className="dashboard-monthly-metric-helper">{helper}</span> : null}
      {description ? (
        <p className="dashboard-monthly-metric-description">{description}</p>
      ) : null}
    </article>
  );
}

function ScenarioCard({ title, amount, quotaAmount, helper, tone = "default" }) {
  const attainment = quotaAmount > 0 ? (Number(amount || 0) / quotaAmount) * 100 : null;
  return (
    <article className={`dashboard-monthly-scenario is-${tone}`.trim()}>
      <span className="dashboard-monthly-scenario-title">{title}</span>
      <strong>{formatCurrency(amount)}</strong>
      <span>{formatPercent(attainment)}</span>
      <p>{helper}</p>
    </article>
  );
}

function QualityCard({ title, amountUsd, total, helper }) {
  return (
    <article className="dashboard-monthly-quality-card">
      <div>
        <span className="dashboard-monthly-quality-title">{title}</span>
        <strong>{formatCompactNumber(total)}</strong>
      </div>
      <div>
        <strong>{formatCurrency(amountUsd)}</strong>
        <span>{helper}</span>
      </div>
    </article>
  );
}

function OutcomePanel({ title, summary, tone }) {
  const dominantStage = summary?.dominantStage;
  return (
    <section className={`dashboard-monthly-outcome is-${tone}`.trim()}>
      <div className="dashboard-monthly-outcome-header">
        <h3>{title}</h3>
        <span>{formatCompactNumber(summary?.total || 0)} oportunidades</span>
      </div>
      <strong className="dashboard-monthly-outcome-amount">
        {formatCurrency(summary?.amountUsd || 0)}
      </strong>
      <p>
        Etapa dominante: {dominantStage?.stageName || "Sin datos"}
        {dominantStage?.amountUsd ? ` · ${formatCurrency(dominantStage.amountUsd)}` : ""}
      </p>
      <ul className="dashboard-monthly-reason-list">
        {(summary?.topReasons || []).length ? (
          summary.topReasons.map((reason) => (
            <li key={reason.reason}>
              <span>{reason.reason}</span>
              <strong>{formatCompactNumber(reason.total)}</strong>
            </li>
          ))
        ) : (
          <li>
            <span>Sin motivos capturados</span>
          </li>
        )}
      </ul>
    </section>
  );
}

export default function Dashboard({ canAccessCommercialTracking = false }) {
  const navigate = useNavigate();
  const [month, setMonth] = useState(getCurrentMonthValue());
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [loading, setLoading] = useState(canAccessCommercialTracking);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    if (!canAccessCommercialTracking) {
      return;
    }

    let ignore = false;

    async function loadDashboard() {
      setLoading(true);
      setError("");
      try {
        const response = await api.get("/api/commercial-tracking/forecast-monthly", {
          params: { month },
        });
        if (!ignore) {
          setPayload(response.data || null);
        }
      } catch (requestError) {
        if (!ignore) {
          setError(
            getApiErrorMessage(
              requestError,
              "No fue posible cargar el dashboard mensual.",
            ),
          );
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void loadDashboard();
    return () => {
      ignore = true;
    };
  }, [canAccessCommercialTracking, month, refreshNonce]);

  const monthOptions = useMemo(() => buildMonthOptions(month), [month]);
  const dashboardMonthly = payload?.dashboardMonthly || null;
  const compositionSegments = useMemo(
    () => buildCompositionSegments(dashboardMonthly),
    [dashboardMonthly],
  );

  if (!canAccessCommercialTracking) {
    return (
      <section className="panel dashboard-monthly-page">
        <header className="dashboard-monthly-header">
          <div>
            <h2>Cumplimiento de Cuota Mensual</h2>
            <p>
              Esta vista requiere acceso a seguimiento comercial y oportunidades.
            </p>
          </div>
        </header>
      </section>
    );
  }

  const quotaAmount = Number(dashboardMonthly?.quota?.monthAmount || 0);
  const headline = dashboardMonthly?.headline || {};
  const forecastBuckets = dashboardMonthly?.forecastBuckets || {};
  const scenarios = dashboardMonthly?.scenarios || {};
  const qualitySummary = dashboardMonthly?.qualitySummary || {};
  const stageFunnel = dashboardMonthly?.stageFunnel || [];
  const originSummary = dashboardMonthly?.originSummary || [];
  const criticalOpportunities = dashboardMonthly?.criticalOpportunities || [];
  const recommendations = dashboardMonthly?.recommendations || [];

  return (
    <section className="panel dashboard-monthly-page">
      <header className="dashboard-monthly-header">
        <div>
          <span className="dashboard-monthly-kicker">Dashboard ejecutivo</span>
          <h2>Cumplimiento de Cuota Mensual</h2>
          <p>
            Lectura global del mes, forecast defendible y acciones para asegurar el cierre.
          </p>
        </div>

        <div className="dashboard-monthly-toolbar">
          <label>
            Mes
            <select value={month} onChange={(event) => setMonth(event.target.value)}>
              {monthOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setRefreshNonce((current) => current + 1)}
          >
            Actualizar
          </button>
        </div>
      </header>

      {error ? <p className="form-error">{error}</p> : null}
      {loading ? <div className="dashboard-monthly-loading">Cargando lectura mensual...</div> : null}

      {!loading && dashboardMonthly ? (
        <div className="dashboard-monthly-layout">
          <section className="dashboard-monthly-hero">
            <div className="dashboard-monthly-hero-main">
              <span className="dashboard-monthly-section-label">Resultado esperado del mes</span>
              <strong>{formatCurrency(headline.totalExpectedAmount || 0)}</strong>
              <p>
                Cuota mensual objetivo: {formatCurrency(quotaAmount)} · Brecha: {formatCurrency(headline.gapAmount || 0)}
              </p>
              <div className="dashboard-monthly-hero-stats">
                <div className="dashboard-monthly-hero-stat-card">
                  <span>Ganado real</span>
                  <strong>{formatCurrency(headline.realWonAmount || 0)}</strong>
                  <small>Venta ya cerrada como ganada en este mes.</small>
                </div>
                <div className="dashboard-monthly-hero-stat-card">
                  <span>Forecast ponderado</span>
                  <strong>{formatCurrency(headline.forecastWeightedAmount || 0)}</strong>
                  <small>Proyección ajustada por etapa y calidad.</small>
                </div>
                <div className="dashboard-monthly-hero-stat-card">
                  <span>Cumplimiento esperado</span>
                  <strong>{formatPercent(headline.expectedAttainmentPercent)}</strong>
                  <small>Porcentaje de cuota que se espera cumplir.</small>
                </div>
              </div>
            </div>
          </section>

          <section className="dashboard-monthly-composition">
            <div className="dashboard-monthly-composition-bar" aria-label="Composicion del mes">
              {compositionSegments.map((segment) => (
                <div
                  key={segment.key}
                  className={`dashboard-monthly-composition-segment is-${segment.tone}`.trim()}
                  style={{ width: `${segment.width}%` }}
                  title={`${segment.label}: ${formatCurrency(segment.value)}`}
                />
              ))}
            </div>
            <div className="dashboard-monthly-composition-legend">
              {compositionSegments.map((segment) => (
                <div key={segment.key}>
                  <span className={`dashboard-monthly-dot is-${segment.tone}`.trim()} />
                  <span>{segment.label}</span>
                  <strong>{formatCurrency(segment.value)}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="dashboard-monthly-metrics-grid">
            <DashboardMetricCard
              label="Meta del mes"
              value={formatCurrency(quotaAmount)}
              helper="Trimestre / 3"
              description="Objetivo total de ventas para este mes."
            />
            <DashboardMetricCard
              label="Vendido"
              value={formatCurrency(headline.realWonAmount || 0)}
              helper={formatPercent(headline.realAttainmentPercent)}
              description="Ya está cerrado y sí cuenta en la cuota."
              tone="success"
            />
            <DashboardMetricCard
              label="Cierre casi seguro"
              value={formatCurrency(forecastBuckets?.committed?.amountUsd || 0)}
              helper={`${formatCompactNumber(forecastBuckets?.committed?.total || 0)} negocios`}
              description="Lo más confiable para cerrar este mes."
              tone="accent"
            />
            <DashboardMetricCard
              label="Puede entrar"
              value={formatCurrency(forecastBuckets?.probable?.amountUsd || 0)}
              helper={`${formatCompactNumber(forecastBuckets?.probable?.total || 0)} negocios`}
              description="Puede cerrar si se mueve bien este mes."
              tone="warning"
            />
            <DashboardMetricCard
              label="En riesgo"
              value={formatCurrency(forecastBuckets?.weak?.amountUsd || 0)}
              helper={`${formatCompactNumber(forecastBuckets?.weak?.total || 0)} negocios`}
              description="Existe, pero hoy se ve lejano para cerrar."
              tone="danger"
            />
            <DashboardMetricCard
              label="Falta para la meta"
              value={formatCurrency(headline.gapAmount || 0)}
              helper="Pendiente por cubrir"
              description="Es lo que aún falta para llegar a la meta."
              tone="danger"
            />
            <DashboardMetricCard
              label="Respaldo real"
              value={formatRatio(headline.coverageRatio)}
              helper="Seguro + en seguimiento"
              description="Si es menor a 1.0x, todavía no alcanza."
            />
            <DashboardMetricCard
              label="Negocios clave"
              value={formatCompactNumber(criticalOpportunities.length)}
              helper="Los que más mueven el mes"
              description="Si avanzan o se caen, cambian el resultado."
            />
          </section>

          <section className="dashboard-monthly-scenarios-grid">
            <ScenarioCard
              title="Escenario conservador"
              amount={scenarios.conservativeAmount || 0}
              quotaAmount={quotaAmount}
              helper="Ganado + comprometido"
              tone="accent"
            />
            <ScenarioCard
              title="Escenario base"
              amount={scenarios.baseAmount || 0}
              quotaAmount={quotaAmount}
              helper="Ganado + comprometido + probable"
              tone="warning"
            />
            <ScenarioCard
              title="Escenario extendido"
              amount={scenarios.extendedAmount || 0}
              quotaAmount={quotaAmount}
              helper="Incluye forecast debil"
              tone="danger"
            />
          </section>

          <div className="dashboard-monthly-grid-two">
            <section className="dashboard-monthly-panel">
              <div className="dashboard-monthly-panel-header">
                <h3>Embudo del mes por etapa</h3>
                <span>{formatCompactNumber(stageFunnel.length)} etapas</span>
              </div>
              <div className="dashboard-monthly-table-wrap">
                <table className="dashboard-monthly-table">
                  <thead>
                    <tr>
                      <th>Etapa</th>
                      <th>Oportunidades</th>
                      <th>Monto bruto</th>
                      <th>Monto ponderado</th>
                      <th>Riesgo dominante</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stageFunnel.map((row) => (
                      <tr key={row.stageCode}>
                        <td>{row.stageName}</td>
                        <td>{formatCompactNumber(row.opportunities)}</td>
                        <td>{formatCurrency(row.grossAmountUsd)}</td>
                        <td>{formatCurrency(row.weightedAmountUsd)}</td>
                        <td>{row.riskLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="dashboard-monthly-panel">
              <div className="dashboard-monthly-panel-header">
                <h3>Calidad operativa del forecast</h3>
                <span>{formatCurrency(forecastBuckets.grossAmountUsd || 0)} brutos</span>
              </div>
              <div className="dashboard-monthly-quality-grid">
                <QualityCard
                  title="Sin siguiente paso"
                  amountUsd={qualitySummary?.noNextStep?.amountUsd || 0}
                  total={qualitySummary?.noNextStep?.total || 0}
                  helper="No deben sostener el mes"
                />
                <QualityCard
                  title="Bloqueadas"
                  amountUsd={qualitySummary?.blocked?.amountUsd || 0}
                  total={qualitySummary?.blocked?.total || 0}
                  helper="Requieren intervencion"
                />
                <QualityCard
                  title="Estancadas"
                  amountUsd={qualitySummary?.stale?.amountUsd || 0}
                  total={qualitySummary?.stale?.total || 0}
                  helper="Sin actividad reciente"
                />
                <QualityCard
                  title="Cierre inconsistente"
                  amountUsd={qualitySummary?.inconsistentClose?.amountUsd || 0}
                  total={qualitySummary?.inconsistentClose?.total || 0}
                  helper="Fecha no alineada con etapa"
                />
                <QualityCard
                  title="Alto monto y alto riesgo"
                  amountUsd={qualitySummary?.highAmountHighRisk?.amountUsd || 0}
                  total={qualitySummary?.highAmountHighRisk?.total || 0}
                  helper="Escalar a gerencia"
                />
              </div>
            </section>
          </div>

          <div className="dashboard-monthly-grid-two">
            <OutcomePanel title="Perdidas" summary={dashboardMonthly?.losses} tone="danger" />
            <OutcomePanel title="Anuladas" summary={dashboardMonthly?.cancelled} tone="muted" />
          </div>

          <div className="dashboard-monthly-grid-two">
            <section className="dashboard-monthly-panel">
              <div className="dashboard-monthly-panel-header">
                <h3>Origen del pipeline del mes</h3>
                <span>{formatCompactNumber(originSummary.length)} orígenes</span>
              </div>
              <div className="dashboard-monthly-table-wrap">
                <table className="dashboard-monthly-table">
                  <thead>
                    <tr>
                      <th>Origen</th>
                      <th>Monto bruto</th>
                      <th>Monto ponderado</th>
                      <th>Ganadas</th>
                      <th>Comprometidas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {originSummary.map((row) => (
                      <tr key={row.origin}>
                        <td>{row.label}</td>
                        <td>{formatCurrency(row.grossAmountUsd)}</td>
                        <td>{formatCurrency(row.weightedAmountUsd)}</td>
                        <td>{formatCurrency(row.wonAmountUsd)}</td>
                        <td>{formatCompactNumber(row.committedCount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="dashboard-monthly-panel">
              <div className="dashboard-monthly-panel-header">
                <h3>Acciones recomendadas</h3>
                <span>Prioridad semanal</span>
              </div>
              <div className="dashboard-monthly-action-list">
                {recommendations.length ? (
                  recommendations.map((item) => (
                    <article key={item.code} className="dashboard-monthly-action-card">
                      <strong>{item.title}</strong>
                      <p>{item.impactLabel}</p>
                    </article>
                  ))
                ) : (
                  <p className="dashboard-monthly-empty">Sin acciones sugeridas.</p>
                )}
              </div>
            </section>
          </div>

          <section className="dashboard-monthly-panel">
            <div className="dashboard-monthly-panel-header dashboard-monthly-panel-header-wide">
              <div>
                <h3>Oportunidades criticas del mes</h3>
                <span>{formatCompactNumber(criticalOpportunities.length)} priorizadas</span>
              </div>
              <div className="dashboard-monthly-panel-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => navigate(`/commercial-tracking?tab=forecast&month=${month}`)}
                >
                  Abrir pipeline
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => navigate("/interactions")}
                >
                  Abrir leads
                </button>
              </div>
            </div>
            <div className="dashboard-monthly-table-wrap">
              <table className="dashboard-monthly-table dashboard-monthly-critical-table">
                <thead>
                  <tr>
                    <th>Oportunidad</th>
                    <th>Cuenta</th>
                    <th>Monto</th>
                    <th>Etapa</th>
                    <th>Forecast</th>
                    <th>Calidad</th>
                    <th>Accion recomendada</th>
                  </tr>
                </thead>
                <tbody>
                  {criticalOpportunities.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <button
                          type="button"
                          className="dashboard-monthly-link"
                          onClick={() => navigate(`/opportunities?edit=${item.id}`)}
                        >
                          {item.name}
                        </button>
                      </td>
                      <td>{item.accountName}</td>
                      <td>{formatCurrency(item.amountUsd)}</td>
                      <td>{item.stageName}</td>
                      <td>
                        {item.categoryLabel} · {formatPercent(item.weightPercent)}
                      </td>
                      <td>
                        {item.qualityLabel} · {formatCompactNumber(item.qualityScore)}
                      </td>
                      <td>{item.recommendedAction}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}