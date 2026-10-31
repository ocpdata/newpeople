import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, getApiErrorMessage } from "../api";
import { CustomerChatQualityTrend } from "./CustomerChatQualityTrend.jsx";
import "./customer-chat-evaluations.css";

const base = "/api/mi-agent/evaluations";
const labels = {
  pending: "En cola", running: "Ejecutando", completed: "Terminada", cancelled: "Cancelada",
  interrupted: "Interrumpida", failed: "Fallido", human_review: "Revisión humana",
  inconclusive: "Inconcluso", environment_error: "Error de entorno", omitted: "Omitido",
};
const active = (run) => ["pending", "running"].includes(run?.status);
const categoryGroups = { Q: "Consultas", G: "Orientación comercial", C: "Contenido", R: "Reportes",
  A: "Acciones controladas", K: "Controles críticos", MIX: "Solicitudes compuestas", L: "Variantes de lenguaje", SEQ: "Conversaciones",
  USR: "Casos creados desde feedback" };
const categoryNames = {
  Q01: "Resumen de cuenta", Q02: "Detalle de registro", Q03: "Consulta de campos", Q04: "Listado de registros",
  Q05: "Búsqueda de registros", Q06: "Historial", Q07: "Pendientes", Q08: "Relaciones entre registros",
  Q09: "Contenido documental", Q10: "Preparación de etapa", Q11: "Ayuda para usar el sistema",
  G01: "Diagnóstico comercial", G02: "Riesgos e información faltante", G03: "Siguientes pasos",
  G04: "Priorización", G05: "Comparación", G06: "Tendencia histórica", G07: "Escenarios hipotéticos", G08: "Estrategia comercial",
  C01: "Correo", C02: "Mensaje breve", C03: "Preparación de reunión", C04: "Preguntas de descubrimiento",
  C05: "Resumen de material", C06: "Explicación", C07: "Reescritura", C08: "Traducción", C09: "Argumento de valor",
  R01: "Declaración del cliente", R02: "Observación del vendedor", R03: "Resultado de conversación",
  R04: "Compromiso", R05: "Evidencia documental", R06: "Hipótesis",
  A01: "Crear registro", A02: "Actualizar campos", A03: "Respuesta de etapa", A04: "Vincular registros",
  A05: "Actividad", A06: "Reprogramar actividad", A07: "Resultado de lead", A08: "Estado o etapa",
  A09: "Eliminar, cancelar o desactivar", A10: "Enviar comunicaciones",
};
const suiteDescriptions = {
  smoke: "Empieza aquí: una selección breve para comprobar consultas, contenido y límites de actuación del chat.",
  full: "Recorre todo el catálogo. Incluye conversaciones de varios mensajes y casos que pueden requerir preparación adicional.",
  selected: "Elige preguntas concretas para revisar una capacidad o volver a probar un problema.",
};
function categoryLabel(category) {
  return `${category} · ${categoryNames[category] || categoryGroups[category.replace(/\d/g, "")] || "Otros casos"}`;
}
function ImpactBadge({ impact }) {
  return <span className={`chat-evaluations-badge is-impact-${impact?.kind || "unknown"}`}>
    {impact?.label || "Efecto de negocio pendiente de clasificar"}
  </span>;
}
function actionState(action) {
  const result = action.result || {};
  const operation = result.operation;
  const validationOutcome = operation?.result?.outcome;
  if (operation?.status === "completed") {
    if (action.proposal?.kind !== "validate_stage" || validationOutcome === "advanced") {
      return { label: "Cambio confirmado por el módulo", tone: "ready" };
    }
    if (validationOutcome === "validated_without_advance") return { label: "Validación finalizada sin avance", tone: "completed" };
    return { label: "Validación finalizada · revisar etapa actual", tone: "warning" };
  }
  if (action.status === "uncertain" || action.status === "started" || ["failed", "expired", "cancelled", "stale"].includes(operation?.status) ||
      result.validation?.status === "failed") {
    return { label: "Resultado incierto o no completado · requiere conciliación", tone: "warning" };
  }
  if (result.outcome === "module_review_required" || operation?.status === "handed_off" && action.proposal?.kind !== "validate_stage") {
    return { label: "Pendiente de guardar en el módulo", tone: "warning" };
  }
  if (result.outcome === "validation_pending" || action.proposal?.kind === "validate_stage" &&
      (result.validation || operation?.result?.validationJobId)) {
    return { label: "Validación iniciada · resultado pendiente", tone: "running" };
  }
  return { label: "Sin cambio confirmado · consulta el estado", tone: "warning" };
}
function download(data, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  URL.revokeObjectURL(url);
}

export function CustomerChatEvaluations({ canExecute = false, canWrite = false }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [catalog, setCatalog] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [runId, setRunId] = useState(() => searchParams.get("evaluationRun") || "");
  const [detail, setDetail] = useState(null);
  const [casePage, setCasePage] = useState(1);
  const [selectedCase, setSelectedCase] = useState(null);
  const [suite, setSuite] = useState("smoke");
  const [category, setCategory] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [repetitions, setRepetitions] = useState(1);
  const [maxTurns, setMaxTurns] = useState(100);
  const [maxMinutes, setMaxMinutes] = useState(30);
  const [preflight, setPreflight] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [filter, setFilter] = useState("");
  const [comparison, setComparison] = useState(null);
  const [compareId, setCompareId] = useState("");
  const [parentId, setParentId] = useState(null);
  const [writeAccount, setWriteAccount] = useState("");
  const [writeAcknowledged, setWriteAcknowledged] = useState(false);
  function selectRun(id) {
    setRunId(id); setCasePage(1); setSelectedCase(null); setDetail(null); setComparison(null);
    const next = new URLSearchParams(searchParams); next.set("evaluationRun", id);
    setSearchParams(next, { replace: true });
  }
  const loadHistory = useCallback(async () => {
    const { data } = await api.get(`${base}/runs?page=${historyPage}`); setHistory(data);
  }, [historyPage]);
  useEffect(() => {
    let stopped = false;
    Promise.all([api.get(`${base}/catalog`), api.get(`${base}/runs?page=${historyPage}`)])
      .then(([catalogResponse, runsResponse]) => {
        if (!stopped) { setCatalog(catalogResponse.data); setHistory(runsResponse.data); }
      }).catch((requestError) => { if (!stopped) setError(getApiErrorMessage(requestError, "No se pudo cargar el catálogo")); });
    return () => { stopped = true; };
  }, [historyPage]);
  useEffect(() => {
    if (!runId) return;
    let stopped = false, timer;
    async function refresh() {
      try {
        const { data } = await api.get(`${base}/runs/${runId}?page=${casePage}`);
        if (stopped) return;
        setDetail(data);
        if (active(data.run)) timer = setTimeout(refresh, 2500);
      } catch (requestError) {
        if (!stopped) setError(getApiErrorMessage(requestError, "No se pudo recuperar la ejecución"));
      }
    }
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [runId, casePage]);
  async function perform(work) {
    setBusy(true); setError("");
    try { await work(); }
    catch (requestError) { setError(getApiErrorMessage(requestError, "No fue posible completar la operación")); }
    finally { setBusy(false); }
  }
  async function launch() {
    const { data } = await api.post(`${base}/runs`, {
      requestKey: crypto.randomUUID(), suite, caseIds: suite === "selected" ? selectedIds : [],
      repetitions: Number(repetitions), maxTurns: Number(maxTurns), maxMinutes: Number(maxMinutes),
      acknowledgePaidCalls: acknowledged, ...(parentId ? { parentId } : {}),
    });
    selectRun(data.id); setParentId(null);
    await loadHistory();
  }
  async function openCase(rowId) {
    const { data } = await api.get(`${base}/runs/${runId}/cases/${rowId}`);
    setSelectedCase(data); setReviewNote(""); setWriteAccount(""); setWriteAcknowledged(false);
    const { data: actions } = await api.get(`${base}/runs/${runId}/cases/${rowId}/actions`);
    setSelectedCase((previous) => previous?.id === rowId ? { ...previous, actionResult: actions } : previous);
  }
  async function review(decision) {
    await api.post(`${base}/runs/${runId}/cases/${selectedCase.id}/review`, { decision, note: reviewNote });
    await openCase(selectedCase.id);
    const { data } = await api.get(`${base}/runs/${runId}?page=${casePage}`); setDetail(data);
  }
  async function repeatFailures() {
    const { data } = await api.get(`${base}/runs/${runId}/export`);
    const ids = [...new Set(data.cases.filter((item) =>
      ["failed", "environment_error", "inconclusive"].includes(item.status) || item.review?.decision === "rejected")
      .map((item) => item.caseId))];
    if (!ids.length) throw new Error("Esta ejecución no tiene casos fallidos o inconclusos.");
    setSuite("selected"); setSelectedIds(ids); setParentId(runId); setAcknowledged(false); setPreflight(null);
  }
  async function compare() {
    const [{ data: current }, { data: previous }] = await Promise.all([
      api.get(`${base}/runs/${runId}/export`), api.get(`${base}/runs/${compareId}/export`),
    ]);
    const key = (item) => `${item.caseId}:${item.repetition}`;
    const previousCases = new Map(previous.cases.map((item) => [key(item), item]));
    setComparison({ compatible: current.configuration.catalogVersion === previous.configuration.catalogVersion &&
      JSON.stringify(current.configuration.runtime) === JSON.stringify(previous.configuration.runtime),
    rows: current.cases.map((item) => ({ id: key(item), before: previousCases.get(key(item))?.status || "No ejecutado",
      after: item.status })) });
  }
  const visibleCatalog = catalog?.cases.filter((item) => !category || item.category === category) || [];
  const caseCount = catalog?.cases.length || 0;
  const blockedCount = catalog?.cases.filter((item) => item.blockedReason).length || 0;
  const selectedCases = catalog?.cases.filter((item) => suite === "full" ||
    (suite === "smoke" ? catalog.smokeCaseIds?.includes(item.id) : selectedIds.includes(item.id))) || [];
  const impactCounts = selectedCases.reduce((counts, item) => {
    const kind = item.businessImpact?.kind || "unknown";
    counts[kind] = (counts[kind] || 0) + 1; return counts;
  }, {});
  const totalCases = detail ? Object.values(detail.counts).reduce((sum, count) => sum + Number(count), 0) : 0;
  const finishedCases = detail ? Object.entries(detail.counts).reduce((sum, [status, count]) =>
    sum + (["pending", "running"].includes(status) ? 0 : Number(count)), 0) : 0;
  async function confirmAction(index) {
    const { data } = await api.post(`${base}/runs/${runId}/cases/${selectedCase.id}/actions`, {
      operationIndex: index, accountId: Number(writeAccount), acknowledgeBusinessWrite: writeAcknowledged,
    }).catch((requestError) => {
      setSelectedCase((previous) => ({ ...previous, actionResult: null }));
      throw requestError;
    });
    const operation = selectedCase.result.steps.at(-1).operations[index];
    setSelectedCase((previous) => ({ ...previous, actionResult: { actions: [
      ...(previous.actionResult?.actions || []).filter((action) => action.operationIndex !== index && !action.key?.endsWith(`:${index}`)),
      { operationIndex: index, proposal: operation, result: data },
    ] } }));
  }
  return <section className="mi-agent-workspace-panel chat-evaluations" aria-label="Pruebas del chat">
    <header className="chat-evaluations-hero">
      <div>
        <span className="chat-evaluations-kicker">Laboratorio de calidad · Mi Coach</span>
        <h2>Pruebas del chat de Cliente existente</h2>
        <p>Comprueba qué responde el chat a tus vendedores, detecta problemas y revisa si las respuestas realmente les ayudan.</p>
      </div>
      <span className="chat-evaluations-instance">Destino: instancia actual</span>
    </header>
    <div className="chat-evaluations-overview">
      <article><strong>Mismo entorno, datos reales</strong><p>Usa esta API, base de datos y configuración de IA, con tus permisos actuales.</p></article>
      <article><strong>Sin confirmar cambios de negocio</strong><p>El lote envía preguntas y guarda sesiones y evidencias. No ejecuta las propuestas del chat.</p></article>
      <article><strong>La calidad la revisas tú</strong><p>Los controles automáticos detectan algunos fallos. Después debes comprobar exactitud y utilidad.</p></article>
    </div>
    <div className="chat-evaluations-catalog" aria-live="polite">
      <span><strong>{catalog ? caseCount : "…"}</strong> casos en el catálogo</span>
      <span><strong>{catalog ? blockedCount : "…"}</strong> requieren preparación y se omiten con explicación</span>
      <span>Las conversaciones pueden consumir varios mensajes.</span>
    </div>
    <CustomerChatQualityTrend canExecute={canExecute} />
    {error ? <p className="chat-evaluations-notice is-error" role="alert">{error}</p> : null}
    {!canExecute ? <p className="chat-evaluations-notice">Tienes acceso de consulta: puedes revisar el historial y sus evidencias.
      Para iniciar pruebas necesitas permiso de ejecución.</p> : null}
    <fieldset className="chat-evaluations-setup" disabled={!canExecute || busy}>
      <legend>Nueva ejecución</legend>
      <section className="chat-evaluations-step" aria-labelledby="evaluation-selection">
        <div className="chat-evaluations-step-heading"><span aria-hidden="true">1</span><div>
          <h3 id="evaluation-selection">Elige qué quieres probar</h3>
          <p>Para una primera revisión, usa la muestra rápida. Después puedes ampliar la cobertura.</p>
        </div></div>
        <div className="chat-evaluations-form-grid">
      <label>Conjunto <select value={suite} onChange={(event) => setSuite(event.target.value)}>
        <option value="smoke">Muestra rápida</option><option value="full">Catálogo completo</option><option value="selected">Casos seleccionados</option>
      </select><small>{suiteDescriptions[suite]}</small></label>
      <label>Categoría <select value={category} disabled={suite !== "selected"} onChange={(event) => setCategory(event.target.value)}>
        <option value="">Todas</option>{[...new Set(catalog?.cases.map((item) => item.category))].map((item) =>
          <option key={item} value={item}>{categoryLabel(item)}</option>)}
      </select><small>{suite === "selected" ? "Filtra la lista visible; no cambia los casos que ya seleccionaste."
        : "Disponible con «Casos seleccionados». No modifica la muestra ni el catálogo completo."}</small></label>
        </div>
      {suite === "selected" ? <div className="chat-evaluations-picker" aria-label="Casos disponibles">
        <div className="chat-evaluations-toolbar">
        <strong>{selectedIds.length} {selectedIds.length === 1 ? "caso seleccionado" : "casos seleccionados"}</strong>
        <button type="button" onClick={() => setSelectedIds((current) => [...new Set([...current, ...visibleCatalog.map((item) => item.id)])])}>
          Seleccionar categoría visible</button>
        <button type="button" onClick={() => setSelectedIds([])}>Limpiar selección</button>
        </div>
        <div className="chat-evaluations-case-list">
        {visibleCatalog.map((item) => <label key={item.id} className="chat-evaluations-check">
          <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={(event) => setSelectedIds((current) =>
            event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />
          <span><strong>{item.id}</strong> · {item.title}
            <span className="chat-evaluations-impact-label"><ImpactBadge impact={item.businessImpact} /></span>
            {item.blockedReason ? <small>Preparación pendiente: {item.blockedReason}. Se omitirá, no contará como aprobado.</small> : null}</span>
        </label>)}
        {!visibleCatalog.length ? <p>No hay casos disponibles en esta categoría.</p> : null}
        </div>
      </div> : null}
      <div className="chat-evaluations-form-grid is-three">
      <label>Repeticiones <input type="number" min="1" max="3" value={repetitions} onChange={(event) => setRepetitions(event.target.value)} />
        <small>De 1 a 3 por caso. Sirve para observar si la respuesta varía; consume más IA.</small></label>
      <label>Límite de mensajes <input type="number" min="1" max="1200" value={maxTurns} onChange={(event) => setMaxTurns(event.target.value)} />
        <small>Tope de todo el lote, no por caso. Una conversación puede necesitar varios mensajes.</small></label>
      <label>Límite de minutos <input type="number" min="1" max="120" value={maxMinutes} onChange={(event) => setMaxMinutes(event.target.value)} />
        <small>Al llegar al límite se detienen los próximos pasos; lo pendiente queda omitido.</small></label>
      </div>
      <aside className="chat-evaluations-impact-summary" aria-label="Efectos de negocio de la selección">
        <strong>Efectos posibles después del lote</strong>
        <p>Ningún caso confirma cambios comerciales durante la ejecución automática.
          Estas marcas indican qué podría ocurrir si autorizas una acción adicional.</p>
        {catalog ? <ul>
          <li>Modificación de datos con confirmación adicional: <strong>{impactCounts.confirm || 0}</strong></li>
          <li>Creación de registros al guardar en el módulo: <strong>{impactCounts.module || 0}</strong></li>
          {impactCounts.form ? <li>Modificación manual de respuestas al guardar en el módulo: <strong>{impactCounts.form}</strong></li> : null}
          <li>Validación con posible autoavance de etapa: <strong>{impactCounts.validation || 0}</strong></li>
          <li>Sin confirmación de negocio prevista: <strong>{impactCounts.none || 0}</strong></li>
          {impactCounts.unknown ? <li>Pendientes de clasificar: <strong>{impactCounts.unknown}</strong>. Revisa su definición antes de autorizar acciones.</li> : null}
        </ul> : <p>Esperando el catálogo para clasificar los efectos de los casos.</p>}
        <small>Conteo de casos distintos, antes de repeticiones; incluye los que requieren preparación y se omiten.
          Todas las ejecuciones guardan sesiones y evidencias técnicas en la base actual.</small>
        <details><summary>Ver marcas de los casos de este conjunto</summary>
          <ul className="chat-evaluations-impact-cases">{selectedCases.map((item) => <li key={item.id}>
            <strong>{item.id}</strong> · {item.title} <ImpactBadge impact={item.businessImpact} />
          </li>)}</ul>
        </details>
      </aside>
      </section>
      <section className="chat-evaluations-step" aria-labelledby="evaluation-preflight">
        <div className="chat-evaluations-step-heading"><span aria-hidden="true">2</span><div>
          <h3 id="evaluation-preflight">Verifica el entorno</h3>
          <p>Comprueba el modelo configurado y el acceso a las cuentas de referencia. Esta comprobación no llama a la IA.</p>
        </div></div>
      <button type="button" className="chat-evaluations-secondary" onClick={() => perform(async () => {
        const { data } = await api.post(`${base}/preflight`); setPreflight(data);
      })}>Verificar entorno</button>
      {preflight ? <div className="chat-evaluations-preflight" role="status">
        <strong>{preflight.providerReady ? "Configuración del proveedor disponible" : "Falta configurar el proveedor de IA"}</strong>
        <dl><div><dt>Modelo</dt><dd>{preflight.model}</dd></div>
          <div><dt>Usuario efectivo</dt><dd>{preflight.userId}</dd></div>
          <div><dt>Versión del catálogo</dt><dd>{preflight.catalogVersion}</dd></div></dl>
        {preflight.accounts.map((item) => <p key={item.accountId}>
          <span className={`chat-evaluations-badge ${item.ready ? "is-ready" : "is-warning"}`}>{item.ready ? "Accesible" : "Revisar acceso"}</span>
          {" "}Cuenta {item.accountId}: {item.ready ? item.reference.account.name : item.message || "No disponible"}
        </p>)}
        {preflight.library ? <p>
          <span className={`chat-evaluations-badge ${preflight.library.ready ? "is-ready" : "is-warning"}`}>
            {preflight.library.ready ? "RAG preparado localmente" : "Preparar RAG"}
          </span>{" "}{preflight.library.reason}
          {" "}Documentos elegibles: {preflight.library.eligibleDocuments}.
        </p> : null}
        <p>Verifica que las cuentas de los casos elegidos estén disponibles. Esto no garantiza la respuesta del proveedor ni aprueba el chat.</p>
      </div> : null}
      </section>
      <section className="chat-evaluations-step" aria-labelledby="evaluation-launch">
        <div className="chat-evaluations-step-heading"><span aria-hidden="true">3</span><div>
          <h3 id="evaluation-launch">Autoriza e inicia la prueba</h3>
          <p>Se enviarán preguntas reales al chat y se conservarán las respuestas para revisarlas después.</p>
        </div></div>
      <label className="chat-evaluations-check chat-evaluations-consent"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
        <span>Autorizo llamadas reales de IA y su costo; no se confirmarán cambios de negocio en este lote.
          <small>Se guardan sesiones, trabajos y evidencias en esta instancia. No se crean datos ficticios ni se revierte información automáticamente.</small></span></label>
      {parentId ? <p className="chat-evaluations-notice">Repetición de fallidos de {parentId}; el resultado anterior se conserva.</p> : null}
      <div className="chat-evaluations-launch">
      <button type="button" className="chat-evaluations-primary" disabled={!preflight?.providerReady || !acknowledged ||
        (suite === "selected" && !selectedIds.length) || active(detail?.run)} onClick={() => perform(launch)}>Ejecutar pruebas</button>
        <p>{!preflight?.providerReady ? "Primero verifica que el proveedor esté configurado."
          : !acknowledged ? "Acepta el uso de IA y su costo para continuar."
            : suite === "selected" && !selectedIds.length ? "Selecciona al menos un caso."
              : active(detail?.run) ? "Espera a que termine la ejecución activa."
                : "Todo listo. El progreso aparecerá debajo y podrás volver a consultarlo en el historial."}</p>
      </div>
      </section>
    </fieldset>
    <section className="chat-evaluations-card" aria-label="Historial de pruebas">
    <div className="chat-evaluations-section-heading"><div><h3>Historial</h3>
      <p>Abre una ejecución para ver sus respuestas y revisiones. Consultarla no vuelve a enviar preguntas.</p></div>
    <button type="button" className="chat-evaluations-secondary" disabled={busy} onClick={() => perform(loadHistory)}>Actualizar historial</button></div>
    {!history ? <p role="status">Cargando historial…</p> : !history.runs.length ? <div className="chat-evaluations-empty">
      <strong>Aún no hay ejecuciones en esta página</strong><p>Cuando inicies una prueba, podrás recuperar aquí sus resultados, incluso después de cerrar la aplicación.</p>
    </div> : null}
    <ul className="chat-evaluations-history">{history?.runs.map((run) => <li key={run.id}>
      <button type="button" aria-current={run.id === runId ? "true" : undefined} disabled={busy} onClick={() => selectRun(run.id)}>
        <span className="chat-evaluations-run-id">{run.id}</span>
        <span className={`chat-evaluations-badge is-${run.status}`}>{labels[run.status] || run.status}</span>
        <time>{String(run.created_at)}</time></button>
    </li>)}</ul>
    <div className="chat-evaluations-pagination"><span>Página {historyPage}</span>
    <button type="button" disabled={historyPage <= 1} onClick={() => setHistoryPage((value) => value - 1)}>Historial anterior</button>
    <button type="button" disabled={!history?.hasMore} onClick={() => setHistoryPage((value) => value + 1)}>Historial siguiente</button>
    </div></section>
    {detail ? <section className="chat-evaluations-card" aria-label="Resultado de ejecución">
      <div className="chat-evaluations-section-heading"><div><h3>Resultado de ejecución</h3>
        <p className="chat-evaluations-run-id">{detail.run.id}</p></div>
        <span className={`chat-evaluations-badge is-${detail.run.status}`}>{labels[detail.run.status] || detail.run.status}</span></div>
      {detail.run.error ? <p role="alert">{detail.run.error}</p> : null}
      <p>{finishedCases} de {totalCases} casos procesados. «Terminada» significa que el lote finalizó, no que todas las respuestas sean correctas.</p>
      <progress className="chat-evaluations-progress" aria-label="Progreso de casos" value={finishedCases} max={totalCases || 1} />
      <div className="chat-evaluations-counts">{Object.entries(detail.counts).map(([status, count]) =>
        <div key={status}><strong>{count}</strong><span>{labels[status] || status}</span></div>)}</div>
      <details className="chat-evaluations-guide"><summary>Cómo interpretar los resultados</summary>
        <dl>
          <div><dt>Revisión humana</dt><dd>No se detectaron fallos automáticos; aún debes verificar los datos, la utilidad y las expectativas del caso.</dd></div>
          <div><dt>Fallido</dt><dd>Falló al menos un control automático. No se puede aprobar sin corregirlo y volver a probar.</dd></div>
          <div><dt>Inconcluso / Error de entorno</dt><dd>No hay evidencia suficiente o falló una dependencia. Revisa el motivo; no equivale a una respuesta incorrecta del modelo.</dd></div>
          <div><dt>Omitido</dt><dd>El caso no se completó por preparación pendiente, cancelación o límites. No cuenta como aprobado.</dd></div>
        </dl>
      </details>
      <div className="chat-evaluations-toolbar">
      <button type="button" disabled={!canExecute || busy || !active(detail.run) || detail.run.cancelRequested}
        onClick={() => perform(async () => {
          await api.post(`${base}/runs/${runId}/cancel`);
          const { data } = await api.get(`${base}/runs/${runId}?page=${casePage}`); setDetail(data);
        })}>Detener próximos pasos</button>
      <button type="button" disabled={busy || active(detail.run)} onClick={() => perform(repeatFailures)}>Seleccionar fallidos para repetir</button>
      <button type="button" disabled={busy} onClick={() => perform(async () => {
        const { data } = await api.get(`${base}/runs/${runId}/export`); download(data, `evaluacion-${runId}.json`);
      })}>Exportar JSON</button>
      </div>
      <label>Filtrar resultado de esta página <select value={filter} onChange={(event) => setFilter(event.target.value)}>
        <option value="">Todos</option>{Object.entries(labels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
      </select></label>
      <div className="chat-evaluations-table"><table><thead><tr><th>Caso</th><th>Efecto previsto</th><th>Repetición</th><th>Resultado</th><th>Revisión humana</th><th>Detalle</th></tr></thead>
        <tbody>{detail.cases.filter((item) => !filter || item.status === filter).map((item) => <tr key={item.id}>
          <td>{item.case_id}</td><td><ImpactBadge impact={item.businessImpact} /></td><td>{item.repetition}</td><td><span className={`chat-evaluations-badge is-${item.status}`}>{labels[item.status] || item.status}</span></td>
          <td>{item.review?.decision === "approved" ? "Aprobada" : item.review?.decision === "rejected" ? "Rechazada" : "Pendiente"}</td>
          <td><button type="button" onClick={() => perform(() => openCase(item.id))}>Ver {item.case_id}</button></td>
        </tr>)}</tbody></table></div>
      {!detail.cases.some((item) => !filter || item.status === filter) ? <p className="chat-evaluations-empty">No hay casos con este resultado en esta página.</p> : null}
      <div className="chat-evaluations-pagination"><span>Página {casePage}</span>
      <button type="button" disabled={casePage <= 1} onClick={() => setCasePage((value) => value - 1)}>Casos anteriores</button>
      <button type="button" disabled={!detail.hasMore} onClick={() => setCasePage((value) => value + 1)}>Casos siguientes</button>
      </div>
      <div className="chat-evaluations-comparison">
      <label>Comparar con <select value={compareId} onChange={(event) => setCompareId(event.target.value)}>
        <option value="">Selecciona ejecución</option>{history?.runs.filter((run) => run.id !== runId).map((run) =>
          <option key={run.id} value={run.id}>{run.id}</option>)}
      </select></label>
      <button type="button" disabled={!compareId || busy} onClick={() => perform(compare)}>Comparar ejecuciones</button>
      </div>
      {comparison ? <section aria-label="Comparación de ejecuciones">
        <p>{comparison.compatible ? "Modelo, permisos, reglas y catálogo coinciden." : "Configuraciones diferentes: no atribuir diferencias solo al chat."}
          Los datos pueden haber cambiado; consulta las referencias de cada caso.</p>
        <ul>{comparison.rows.map((row) => <li key={row.id}>{row.id}: {labels[row.before] || row.before} → {labels[row.after] || row.after}</li>)}</ul>
      </section> : null}
    </section> : null}
    {selectedCase ? <section className="chat-evaluations-card chat-evaluations-detail" aria-label="Detalle del caso">
      <h3>{selectedCase.caseId} · {labels[selectedCase.status] || selectedCase.status}</h3>
      <aside className="chat-evaluations-impact-summary">
        <ImpactBadge impact={selectedCase.definition.businessImpact} />
        <p>{selectedCase.definition.businessImpact?.description || "Clasificación no disponible. Revisa la definición y las propuestas reales antes de autorizar acciones."}</p>
        <p>Esta es la previsión del caso, no evidencia de que se haya modificado un registro.</p>
      </aside>
      <p>{selectedCase.result?.reason || selectedCase.definition.blockedReason}</p>
      {selectedCase.jobId ? <p>Último trabajo: {selectedCase.jobId} · Sesión: {selectedCase.sessionId || "No disponible"}</p> : null}
      <details><summary>Definición y expectativas del caso</summary><pre>{JSON.stringify(selectedCase.definition, null, 2)}</pre></details>
      {selectedCase.result?.steps?.map((step, index) => <article className="chat-evaluations-turn" key={index}>
        <h4>Turno {index + 1}</h4><p><strong>Pregunta:</strong> {step.question}</p>
        <p>Trabajo: {step.jobId || "No disponible"} · Duración: {step.durationMs == null ? "No disponible" : `${step.durationMs} ms`}</p>
        <p><strong>Esperado:</strong> {step.expected}</p><p style={{ whiteSpace: "pre-wrap" }}><strong>Respuesta:</strong> {step.answer}</p>
        {step.activityHistory ? <details>
          <summary>Historial estructurado devuelto por el chat</summary>
          {step.activityHistory.sections?.map((section) => <section key={section.key}>
            <h5>{section.title}</h5>
            {section.subtitle ? <p>{section.subtitle}</p> : null}
            {!section.available ? <p>{section.unavailableMessage}</p> : <ul>
              {section.items?.map((item) => <li key={item.id}>
                <strong>{item.title}</strong>
                <p>{[item.sourceTitle, item.recordId ? `Registro ${item.recordId}` : "", item.date,
                  item.dateMeaning, item.accountLink, item.opportunityName, item.status].filter(Boolean).join(" · ")}</p>
                {item.details ? <p style={{ whiteSpace: "pre-wrap" }}>{item.details}</p> : null}
              </li>)}
            </ul>}
          </section>)}
          <pre>{JSON.stringify(step.activityHistory, null, 2)}</pre>
        </details> : null}
        <ul>{step.checks?.map((check, checkIndex) => <li key={checkIndex}>{check.passed ? "Correcto" : "Fallo"}: {check.name} — {check.detail}</li>)}</ul>
        <details><summary>Propuestas y fuentes</summary><pre>{JSON.stringify({ operations: step.operations, evidence: step.evidence }, null, 2)}</pre></details>
      </article>)}
      <details><summary>Lecturas de referencia y evidencia completa</summary><pre>{JSON.stringify(selectedCase.result, null, 2)}</pre></details>
      <section className="chat-evaluations-business-actions" aria-label="Efectos reales de las acciones">
        <h4>Propuestas reales y cambios confirmados</h4>
        <p>El efecto se determina por la propuesta devuelta y la respuesta del módulo, no por el código del caso ni por aprobar su calidad.</p>
        {selectedCase.result?.steps?.map((step, stepIndex) => step.operations?.map((operation, index) =>
          <article key={`${stepIndex}:${index}`} className="chat-evaluations-action">
            <strong>Turno {stepIndex + 1} · {operation.title || operation.kind}</strong>
            <ImpactBadge impact={catalog?.operationBusinessImpacts?.[operation.kind]} />
            <p>{catalog?.operationBusinessImpacts?.[operation.kind]?.description || "Tipo no confirmable desde este evaluador. No autorices un efecto que no esté definido."}</p>
            <p>Cuenta: {operation.accountId ?? "No indicada"} · Registro: {operation.activityId || operation.opportunityId || operation.contactId || operation.leadId || "Ver propuesta"}</p>
            <span className="chat-evaluations-badge">Propuesta sin ejecución acreditada por el chat</span>
          </article>))}
        {!selectedCase.result?.steps?.some((step) => step.operations?.length) ? <p>No se devolvieron propuestas ejecutables.</p> : null}
        {selectedCase.actionResult?.actions?.map((action, index) => {
          const state = actionState(action);
          return <article key={action.key || index} className="chat-evaluations-action">
            <strong>{action.proposal?.title || action.proposal?.kind || `Acción ${index + 1}`}</strong>
            <span className={`chat-evaluations-badge is-${state.tone}`}>{state.label}</span>
            {action.result?.handoff?.url ? <a href={action.result.handoff.url}>Abrir módulo existente</a> : null}
          </article>;
        })}
        {!selectedCase.actionResult ? <p>Estado de confirmaciones no disponible todavía. Consulta las acciones; no asumas que no hubo cambios.</p>
          : !selectedCase.actionResult.actions?.length ? <p>No hay confirmaciones de negocio registradas para este caso.</p> : null}
        <button type="button" className="chat-evaluations-secondary" disabled={busy} onClick={() => perform(async () => {
          const { data } = await api.get(`${base}/runs/${runId}/cases/${selectedCase.id}/actions`);
          setSelectedCase((previous) => ({ ...previous, actionResult: data }));
        })}>Consultar estado de acciones sin repetir</button>
        <small>Consultar no vuelve a ejecutar la acción. Si un resultado es incierto, revisa el registro y la operación original; no asumas guardado ni reversión.</small>
        {selectedCase.actionResult ? <details><summary>Evidencia de acciones y módulos</summary><pre>{JSON.stringify(selectedCase.actionResult, null, 2)}</pre></details> : null}
      </section>
      {selectedCase.review ? <p>Revisión: {selectedCase.review.decision === "approved" ? "Aprobada" : "Rechazada"} — {selectedCase.review.note}</p> : null}
      {canExecute && ["human_review", "failed"].includes(selectedCase.status) ? <fieldset disabled={busy}>
        <legend>Revisión humana — no borra comprobaciones automáticas</legend>
        <p>Compara la respuesta con los datos vigentes y lo esperado: ¿es correcta, completa y útil para el vendedor?
          Explica tu decisión con al menos 10 caracteres. Aprobar no ejecuta ninguna propuesta.</p>
        <label>Justificación <textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /></label>
        <button type="button" disabled={reviewNote.trim().length < 10 || selectedCase.status === "failed"} onClick={() => perform(() => review("approved"))}>Aprobar semántica</button>
        <button type="button" disabled={reviewNote.trim().length < 10} onClick={() => perform(() => review("rejected"))}>Rechazar semántica</button>
      </fieldset> : null}
      {canWrite && selectedCase.result?.steps?.at(-1)?.operations?.length ? <fieldset disabled={busy || active(detail?.run) ||
        selectedCase.status !== "human_review" || selectedCase.review?.decision !== "approved"}>
        <legend>Escritura controlada — cambia datos de esta instancia</legend>
        <p>Solo sobre la cuenta y los registros expresamente autorizados para pruebas. No hay reversión automática. A08 puede avanzar la etapa.</p>
        <p>Primero debe aprobarse la revisión semántica; esa aprobación no ejecuta la propuesta.</p>
        <label>ID de cuenta autorizada para esta prueba <input value={writeAccount} onChange={(event) => setWriteAccount(event.target.value)} /></label>
        <label className="chat-evaluations-check chat-evaluations-consent"><input type="checkbox" checked={writeAcknowledged} onChange={(event) => setWriteAcknowledged(event.target.checked)} />
          <span>Revisé la propuesta y autorizo su efecto real sobre estos registros de prueba.</span></label>
        {selectedCase.result.steps.at(-1).operations.map((operation, index) => <div key={index}>
          <p>{operation.title} · {operation.kind}</p>
          <ImpactBadge impact={catalog?.operationBusinessImpacts?.[operation.kind]} />
          <p>{catalog?.operationBusinessImpacts?.[operation.kind]?.description}</p>
          <p>Cuenta {operation.accountId} · Registro {operation.activityId || operation.opportunityId || operation.contactId || operation.leadId || "Ver propuesta completa antes de guardar"}.
            Revisa los campos y valores en «Propuestas y fuentes» antes de autorizar.</p>
          <button type="button" disabled={!writeAcknowledged || !writeAccount}
            onClick={() => perform(() => confirmAction(index))}>Confirmar acción {index + 1}</button>
        </div>)}
      </fieldset> : null}
    </section> : null}
  </section>;
}
