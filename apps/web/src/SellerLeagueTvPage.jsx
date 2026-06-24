import { useEffect, useMemo, useState } from "react";
import { api, getApiErrorMessage } from "./api";
import "./seller-league-tv.css";

function formatCurrency(value) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatPercent(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "-";
  }
  return `${numericValue.toFixed(1)}%`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function getTrendMeta(value) {
  const delta = Number(value || 0);
  if (delta > 0) {
    return { icon: "▲", tone: "up", label: `+${delta.toFixed(1)}` };
  }
  if (delta < 0) {
    return { icon: "▼", tone: "down", label: delta.toFixed(1) };
  }
  return { icon: "•", tone: "flat", label: "0.0" };
}

function getScoreTone(score) {
  const value = Number(score || 0);
  if (value >= 85) return "elite";
  if (value >= 70) return "solid";
  if (value >= 55) return "racing";
  return "risk";
}

function TeamStatCard({ label, value, helper, tone = "default" }) {
  return (
    <article className={`seller-league-stat-card tone-${tone}`.trim()}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </article>
  );
}

function PodiumCard({ row, place }) {
  if (!row) {
    return (
      <article className="seller-league-podium-card is-empty">
        <span>Top {place}</span>
        <strong>Sin dato</strong>
      </article>
    );
  }

  return (
    <article className={`seller-league-podium-card place-${place}`.trim()}>
      <span>#{place}</span>
      <strong>{row.sellerUserName}</strong>
      <p>{row.scoreTotal?.toFixed(1) || "0.0"} pts</p>
      <small>{formatPercent(row.attainmentPct)}</small>
    </article>
  );
}

export default function SellerLeagueTvPage() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadDashboard() {
    try {
      const { data } = await api.get("/api/commercial-tracking/seller-league-tv");
      setPayload(data || null);
      setError("");
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar la liga comercial trimestral",
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();

    const refreshId = window.setInterval(() => {
      loadDashboard();
    }, 5 * 60 * 1000);

    return () => {
      window.clearInterval(refreshId);
    };
  }, []);

  const topThree = useMemo(() => {
    const rows = Array.isArray(payload?.leaderboard) ? payload.leaderboard : [];
    return rows.filter((row) => row.isOfficial).slice(0, 3);
  }, [payload]);

  const leaderboard = Array.isArray(payload?.leaderboard)
    ? payload.leaderboard
    : [];
  const team = payload?.team || {};
  const period = payload?.period || {};

  return (
    <section className="panel seller-league-page">
      <header className="seller-league-header">
        <div>
          <h2>Liga Comercial Trimestral</h2>
          <p>
            Tablero competitivo diario para vendedores. Actualizado cada 5
            minutos.
          </p>
        </div>
        <div className="seller-league-header-meta">
          <span>{period.label || "Trimestre actual"}</span>
          <span>
            Actualizado: {payload?.generatedAt ? new Date(payload.generatedAt).toLocaleTimeString("es-MX") : "-"}
          </span>
        </div>
      </header>

      {error ? <p className="form-error">{error}</p> : null}

      {loading ? (
        <div className="seller-league-empty">Cargando liga comercial...</div>
      ) : null}

      {!loading ? (
        <>
          <div className="seller-league-stat-grid">
            <TeamStatCard
              label="Cumplimiento equipo"
              value={formatPercent(team.attainmentPct)}
              helper="Ganado vs cuota trimestral"
              tone="accent"
            />
            <TeamStatCard
              label="Ganado equipo"
              value={formatCurrency(team.wonAmountUsd)}
              helper={`Cuota ${formatCurrency(team.quotaAmountUsd)}`}
            />
            <TeamStatCard
              label="Vendedores oficiales"
              value={formatNumber(team.sellersOfficial)}
              helper={`${formatNumber(team.sellersVisible)} visibles`}
            />
            <TeamStatCard
              label="Alertas críticas"
              value={formatNumber(
                Number(team.overdueCount || 0) +
                  Number(team.noNextStepCount || 0) +
                  Number(team.blockedCriticalCount || 0),
              )}
              helper="Vencidos + sin paso + bloqueadas"
              tone="alert"
            />
          </div>

          <div className="seller-league-layout">
            <section className="seller-league-main-table-wrap">
              <table className="seller-league-main-table">
                <thead>
                  <tr>
                    <th title="Posición en el ranking oficial">Pos</th>
                    <th title="Nombre del vendedor">Vendedor</th>
                    <th title="Puntaje final: 50% cierre + 30% construcción + 20% disciplina">Score</th>
                    <th title="Monto ganado vs cuota trimestral (0–100)">Cierre</th>
                    <th title="Cobertura de pipeline, avance de etapas y calidad operativa (0–100)">Construcción</th>
                    <th title="Penalización por vencidos, sin siguiente paso y bloqueadas (0–100)">Disciplina</th>
                    <th title="Meta trimestral individual publicada en USD">Cuota</th>
                    <th title="Monto ganado acumulado en el trimestre actual">Ganado</th>
                    <th title="Indicador de aceleración: avances recientes y cierre acumulado">Tendencia</th>
                    <th title="Diferencia de score respecto al puesto superior">Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((row) => {
                    const trend = getTrendMeta(row.momentum7d);
                    return (
                      <tr key={row.sellerUserId}>
                        <td>{row.rankPosition || "-"}</td>
                        <td>
                          <div className="seller-league-name-cell">
                            <strong>{row.sellerUserName}</strong>
                            {!row.isOfficial ? (
                              <span>Sin cuota publicada</span>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <div className={`seller-league-score-cell tone-${getScoreTone(row.scoreTotal)}`.trim()}>
                            <div className="seller-league-score-value">
                              {row.scoreTotal?.toFixed(1) || "-"}
                            </div>
                            <div className="seller-league-score-bar" style={{ width: `${Math.min(Number(row.scoreTotal || 0), 100)}%` }} />
                          </div>
                        </td>
                        <td>{row.scoreClosing?.toFixed(1) || "-"}</td>
                        <td>{row.scoreBuild?.toFixed(1) || "-"}</td>
                        <td>{row.scoreDiscipline?.toFixed(1) || "-"}</td>
                        <td>{formatCurrency(row.quotaAmountUsd)}</td>
                        <td>{formatCurrency(row.wonAmountUsd)}</td>
                        <td>
                          <span className={`seller-league-trend tone-${trend.tone}`.trim()}>
                            {trend.icon} {trend.label}
                          </span>
                        </td>
                        <td>{row.rankGapToNext?.toFixed(1) || "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            <aside className="seller-league-side">
              <section className="seller-league-podium">
                <h3>Podio del día</h3>
                <div className="seller-league-podium-grid">
                  <PodiumCard row={topThree[0]} place={1} />
                  <PodiumCard row={topThree[1]} place={2} />
                  <PodiumCard row={topThree[2]} place={3} />
                </div>
              </section>

              <section className="seller-league-alerts">
                <h3>Foco del día</h3>
                <ul>
                  <li>
                    Seguimientos vencidos: {formatNumber(team.overdueCount)}
                  </li>
                  <li>
                    Oportunidades sin siguiente paso: {formatNumber(team.noNextStepCount)}
                  </li>
                  <li>
                    Bloqueadas críticas: {formatNumber(team.blockedCriticalCount)}
                  </li>
                </ul>
              </section>
            </aside>
          </div>
        </>
      ) : null}
    </section>
  );
}
