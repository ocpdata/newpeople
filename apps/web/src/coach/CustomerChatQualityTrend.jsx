import { useCallback, useEffect, useState } from "react";
import { api, getApiErrorMessage } from "../api";

const base = "/api/mi-agent/evaluations";
const SOURCES = {
  contract: "Interpretación del turno (live)",
  pipeline: "Recorridos completos (live)",
  evaluation_module: "Pruebas de este laboratorio",
  production_monitor: "Producción · últimos 7 días",
};
const GROUPS = {
  catalog: "Categoría y objeto", dialogue: "Movimiento de diálogo", critical: "Controles críticos",
  dimensions: "Dimensiones", scenarios: "Recorridos", cases: "Comprobaciones automáticas",
  reliability: "Turnos sin fallo", satisfaction: "Valoraciones positivas",
};
const STATUS = { passed: "Dentro del umbral", failed: "Bajo el umbral", regressed: "Bajó frente a la anterior" };
const TRIGGERS = { manual: "Manual", ci: "CI", scheduled: "Programada", in_app: "En la aplicación" };

const dateFormat = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" });
const formatDate = (value) => dateFormat.format(new Date(value));
const percent = (group) => (group.total ? Math.round((group.passed / group.total) * 100) : null);

function overallScore(groups) {
  const values = Object.values(groups || {});
  const total = values.reduce((sum, group) => sum + group.total, 0);
  return total ? values.reduce((sum, group) => sum + group.passed, 0) / total : null;
}

function Sparkline({ runs, label }) {
  const points = runs.map((run) => ({ run, score: overallScore(run.groups) })).filter((item) => item.score !== null);
  if (points.length < 2) return <p className="chat-quality-hint">Aún no hay suficientes ejecuciones para mostrar una tendencia.</p>;
  const width = 240;
  const height = 48;
  const step = width / (points.length - 1);
  const coordinates = points.map((item, index) => [index * step, 4 + (1 - item.score) * (height - 8)]);
  return <svg className="chat-quality-sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
    <polyline points={coordinates.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} fill="none" strokeWidth="2" />
    {points.map((item, index) => <circle key={item.run.id} cx={coordinates[index][0]} cy={coordinates[index][1]} r="3"
      className={`is-${item.run.status}`}><title>{`${formatDate(item.run.evaluatedAt)}: ${Math.round(item.score * 100)}%`}</title></circle>)}
  </svg>;
}

function SourceCard({ source, latest, runs }) {
  const trend = runs.filter((run) => run.source === source);
  return <article className={`chat-quality-card is-${latest?.status || "empty"}`}>
    <h4>{SOURCES[source]}</h4>
    {latest ? <>
      <p className="chat-quality-status">{STATUS[latest.status] || latest.status}</p>
      <ul className="chat-quality-groups">
        {Object.entries(latest.groups).map(([name, group]) => <li key={name}>
          <span>{GROUPS[name] || name}</span><strong>{group.passed}/{group.total}{percent(group) === null ? "" : ` · ${percent(group)}%`}</strong>
        </li>)}
      </ul>
      {latest.metrics?.turns !== undefined ? <small>
        {latest.metrics.turns} turnos · {latest.metrics.failedTurns} fallidos · {latest.metrics.negativeRatings} valoraciones 👎
        {latest.metrics.latencyP95Seconds !== null && latest.metrics.latencyP95Seconds !== undefined ? ` · p95 ${Math.round(latest.metrics.latencyP95Seconds)} s` : ""}
      </small> : null}
      {latest.reasons.length ? <ul className="chat-quality-reasons">{latest.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
      <Sparkline runs={trend} label={`Tendencia de ${SOURCES[source]}`} />
      <small>{formatDate(latest.evaluatedAt)}{latest.model ? ` · ${latest.model}` : ""}{latest.commit ? ` · ${latest.commit.slice(0, 7)}` : ""}</small>
    </> : <p className="chat-quality-hint">Sin ejecuciones registradas.</p>}
  </article>;
}

const validOverview = (data) => Array.isArray(data?.runs) && data.latest && typeof data.latest === "object";

function WeeklySwitch({ settings, canExecute, busy, onToggle }) {
  const enabled = Boolean(settings.weeklyEnabled);
  return <div className={`chat-quality-weekly${enabled ? " is-on" : ""}`}>
    <div>
      <h4>Evaluación semanal en GitHub</h4>
      <p>{enabled
        ? "Activada: cada lunes GitHub ejecuta las evaluaciones live (con costo de IA) y envía el resultado aquí."
        : "Desactivada: GitHub no ejecutará las evaluaciones live programadas ni las de los PR con etiqueta. Una ejecución manual desde GitHub siempre se realiza."}</p>
      <small>
        {settings.updatedAt ? `Último cambio: ${formatDate(settings.updatedAt)}${settings.updatedBy ? ` por ${settings.updatedBy}` : ""}. ` : ""}
        {settings.lastCiReportAt ? `Último reporte recibido: ${formatDate(settings.lastCiReportAt)}.` : "Aún no se ha recibido ningún reporte de GitHub."}
      </small>
      {!settings.ciConfigured ? <small className="chat-quality-warning">
        Falta configurar el token del servidor (CUSTOMER_CHAT_QUALITY_CI_TOKEN). Sin él, GitHub no puede consultar este interruptor ni enviar resultados.</small> : null}
    </div>
    {canExecute ? <button type="button" className="chat-evaluations-secondary" disabled={busy} aria-pressed={enabled} onClick={() => onToggle(!enabled)}>
      {enabled ? "Desactivar evaluación semanal" : "Activar evaluación semanal"}</button> : null}
  </div>;
}

export function CustomerChatQualityTrend({ canExecute = false }) {
  const [overview, setOverview] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.get(`${base}/quality`);
    if (validOverview(data)) setOverview(data);
  }, []);

  useEffect(() => {
    let stopped = false;
    api.get(`${base}/quality`).then(({ data }) => { if (!stopped && validOverview(data)) setOverview(data); })
      .catch((error) => { if (!stopped) setMessage(getApiErrorMessage(error, "No se pudo cargar la calidad en el tiempo")); });
    return () => { stopped = true; };
  }, []);

  async function refreshProduction() {
    setBusy(true);
    setMessage("");
    try {
      await api.post(`${base}/quality/production-snapshot`);
      await load();
    } catch (error) {
      setMessage(getApiErrorMessage(error, "No se pudo actualizar el monitoreo"));
    } finally {
      setBusy(false);
    }
  }

  async function toggleWeekly(weeklyEnabled) {
    setBusy(true);
    setMessage("");
    try {
      const { data } = await api.put(`${base}/quality/settings`, { weeklyEnabled });
      setOverview((previous) => (previous ? { ...previous, settings: data } : previous));
    } catch (error) {
      setMessage(getApiErrorMessage(error, "No se pudo cambiar la evaluación semanal"));
    } finally {
      setBusy(false);
    }
  }

  const problems = overview ? Object.values(overview.latest).filter((run) => run.status !== "passed") : [];
  const recent = overview ? [...overview.runs].reverse().slice(0, 8) : [];
  return <section className="chat-quality" aria-labelledby="chat-quality-title">
    <div className="chat-evaluations-section-heading"><div>
      <h3 id="chat-quality-title">Calidad en el tiempo</h3>
      <p>Cada evaluación queda registrada con su fecha, modelo y versión del código para detectar cuándo mejora o empeora el chat.</p>
    </div>
    {canExecute ? <button type="button" className="chat-evaluations-secondary" disabled={busy} onClick={refreshProduction}>
      {busy ? "Actualizando…" : "Actualizar monitoreo de producción"}</button> : null}
    </div>
    {message ? <p className="chat-evaluations-notice is-error">{message}</p> : null}
    {problems.length ? <p className="chat-evaluations-notice is-error">
      Requiere atención: {problems.map((run) => `${SOURCES[run.source]} (${STATUS[run.status] || run.status})`).join("; ")}.</p> : null}
    {overview?.settings ? <WeeklySwitch settings={overview.settings} canExecute={canExecute} busy={busy} onToggle={toggleWeekly} /> : null}
    {overview ? <>
      <div className="chat-quality-grid">
        {Object.keys(SOURCES).map((source) => <SourceCard key={source} source={source} latest={overview.latest[source]} runs={overview.runs} />)}
      </div>
      {recent.length ? <details className="chat-quality-history">
        <summary>Ejecuciones recientes ({recent.length})</summary>
        <table className="chat-evaluations-table">
          <thead><tr><th>Fecha</th><th>Fuente</th><th>Resultado</th><th>Origen</th><th>Versión</th></tr></thead>
          <tbody>{recent.map((run) => <tr key={run.id}>
            <td>{formatDate(run.evaluatedAt)}</td><td>{SOURCES[run.source]}</td><td>{STATUS[run.status] || run.status}</td>
            <td>{TRIGGERS[run.trigger] || run.trigger}</td><td>{run.commit ? run.commit.slice(0, 7) : "—"}</td>
          </tr>)}</tbody>
        </table>
      </details> : null}
    </> : !message ? <p className="chat-quality-hint">Cargando…</p> : null}
  </section>;
}
