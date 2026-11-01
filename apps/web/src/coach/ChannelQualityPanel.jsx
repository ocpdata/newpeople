import { useCallback, useEffect, useState } from "react";
import { api, getApiErrorMessage } from "../api";
import "./channel-quality.css";

const base = "/api/mi-agent/channel-quality";
const CHANNELS = { coach: "Coach", prospect: "Cuenta nueva" };
const SOURCES = {
  lab: "Pruebas de laboratorio (sin IA)",
  live: "Evaluación con IA real",
  production_monitor: "Producción · últimos 7 días",
};
const GROUPS = {
  cases: "Casos del laboratorio",
  known_gaps_fixed: "Brechas conocidas corregidas",
  reliability: "Turnos sin fallo",
  satisfaction: "Valoraciones positivas",
  cat_gen: "General",
  cat_account: "Búsqueda de oportunidades",
  cat_opp: "Oportunidades",
  cat_entity: "Entidades",
  cat_contact: "Contactos",
  cat_lead: "Leads",
  cat_action: "Acciones",
  cat_intent: "Enrutamiento de intención",
  cat_answer: "Respuestas de la sesión",
};
const STATUS = { passed: "Dentro del umbral", failed: "Bajo el umbral", regressed: "Bajó frente a la anterior" };

const dateFormat = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" });
const formatDate = (value) => dateFormat.format(new Date(value));
const percent = (group) => (group.total ? Math.round((group.passed / group.total) * 100) : null);

// Known gaps are tracked apart: they must not move the overall score.
function overallScore(groups) {
  const main = groups?.cases || groups?.reliability;
  return main && main.total ? main.passed / main.total : null;
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

export function ChannelQualityPanel({ canExecute = false }) {
  const [channel, setChannel] = useState("coach");
  const [overview, setOverview] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (target) => {
    const { data } = await api.get(`${base}/${target}`);
    if (validOverview(data)) setOverview(data);
  }, []);

  useEffect(() => {
    let stopped = false;
    api.get(`${base}/${channel}`).then(({ data }) => { if (!stopped && validOverview(data)) setOverview(data); })
      .catch((error) => { if (!stopped) setMessage(getApiErrorMessage(error, "No se pudo cargar la calidad del canal")); });
    return () => { stopped = true; };
  }, [channel]);

  function selectChannel(key) {
    setOverview(null);
    setMessage("");
    setChannel(key);
  }

  async function refreshProduction() {
    setBusy(true);
    setMessage("");
    try {
      await api.post(`${base}/${channel}/production-snapshot`);
      await load(channel);
    } catch (error) {
      setMessage(getApiErrorMessage(error, "No se pudo actualizar el monitoreo"));
    } finally {
      setBusy(false);
    }
  }

  const recent = overview ? [...overview.runs].reverse().slice(0, 8) : [];
  return <div className="chat-evaluations"><section className="chat-quality" aria-labelledby="channel-quality-title">
    <div className="chat-evaluations-section-heading"><div>
      <h3 id="channel-quality-title">Calidad de Coach y Cuenta nueva</h3>
      <p>Cada ejecución queda registrada con su fecha y versión del código. El laboratorio no usa IA ni genera costo; el monitoreo de producción se calcula con los turnos y valoraciones reales.</p>
    </div>
    {canExecute ? <button type="button" className="chat-evaluations-secondary" disabled={busy} onClick={refreshProduction}>
      {busy ? "Actualizando…" : "Actualizar monitoreo de producción"}</button> : null}</div>
    <div role="tablist" aria-label="Canal" className="channel-quality-tabs">
      {Object.entries(CHANNELS).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={channel === key}
        className={channel === key ? "is-active chat-evaluations-secondary" : "chat-evaluations-secondary"} onClick={() => selectChannel(key)}>{label}</button>)}
    </div>
    {message ? <p role="alert" className="chat-quality-warning">{message}</p> : null}
    {overview ? <>
      <div className="chat-quality-grid">
        {Object.keys(SOURCES).map((source) => <SourceCard key={source} source={source} latest={overview.latest[source]} runs={overview.runs} />)}
      </div>
      <h4>Ejecuciones recientes</h4>
      {recent.length ? <table className="channel-quality-runs">
        <thead><tr><th>Fecha</th><th>Fuente</th><th>Estado</th><th>Versión</th></tr></thead>
        <tbody>{recent.map((run) => <tr key={run.id}>
          <td>{formatDate(run.evaluatedAt)}</td><td>{SOURCES[run.source]}</td>
          <td>{STATUS[run.status] || run.status}</td><td>{run.commit ? run.commit.slice(0, 7) : "—"}</td>
        </tr>)}</tbody>
      </table> : <p className="chat-quality-hint">Todavía no hay ejecuciones registradas para este canal.</p>}
    </> : !message ? <p className="chat-quality-hint">Cargando…</p> : null}
  </section></div>;
}
