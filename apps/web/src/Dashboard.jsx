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

function OutcomePanel({ title, summary, tone }) {
  return (
    <section className={`dashboard-monthly-outcome is-${tone}`.trim()}>
      <div className="dashboard-monthly-outcome-header">
        <h3>{title}</h3>
        <span>{formatCompactNumber(summary?.total || 0)} oportunidades</span>
      </div>
      <strong className="dashboard-monthly-outcome-amount">
        {formatCurrency(summary?.amountUsd || 0)}
      </strong>
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
  const stageFunnel = dashboardMonthly?.stageFunnel || [];
  const stageFunnelRows = stageFunnel.filter(
    (row) => String(row.stageCode || "") !== "ganada",
  );
  const stageFunnelTotal = stageFunnelRows.reduce(
    (accumulator, row) => ({
      opportunities:
        accumulator.opportunities + Number(row.opportunities || 0),
      grossAmountUsd:
        accumulator.grossAmountUsd + Number(row.grossAmountUsd || 0),
      weightedAmountUsd:
        accumulator.weightedAmountUsd + Number(row.weightedAmountUsd || 0),
    }),
    { opportunities: 0, grossAmountUsd: 0, weightedAmountUsd: 0 },
  );
  const criticalOpportunities = dashboardMonthly?.criticalOpportunities || [];

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
                  <small>Proyección por etapa (sin ajuste de calidad/riesgo).</small>
                </div>
                <div className="dashboard-monthly-hero-stat-card">
                  <span>Cumplimiento esperado</span>
                  <strong>{formatPercent(headline.expectedAttainmentPercent)}</strong>
                  <small>Porcentaje de cuota que se espera cumplir.</small>
                </div>
              </div>
            </div>
          </section>

          <section className="dashboard-monthly-panel">
            <div className="dashboard-monthly-panel-header">
              <h3>Embudo del mes por etapa</h3>
              <span>{formatCompactNumber(stageFunnelRows.length)} etapas</span>
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
                  {stageFunnelRows.map((row) => (
                    <tr key={row.stageCode}>
                      <td>{row.stageName}</td>
                      <td>{formatCompactNumber(row.opportunities)}</td>
                      <td>{formatCurrency(row.grossAmountUsd)}</td>
                      <td>{formatCurrency(row.weightedAmountUsd)}</td>
                      <td>{row.riskLabel}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <strong>Total</strong>
                    </td>
                    <td>
                      <strong>{formatCompactNumber(stageFunnelTotal.opportunities)}</strong>
                    </td>
                    <td>
                      <strong>{formatCurrency(stageFunnelTotal.grossAmountUsd)}</strong>
                    </td>
                    <td>
                      <strong>{formatCurrency(stageFunnelTotal.weightedAmountUsd)}</strong>
                    </td>
                    <td>
                      <strong>-</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <div className="dashboard-monthly-grid-two">
            <OutcomePanel title="Perdidas" summary={dashboardMonthly?.losses} tone="danger" />
            <OutcomePanel title="Anuladas" summary={dashboardMonthly?.cancelled} tone="muted" />
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