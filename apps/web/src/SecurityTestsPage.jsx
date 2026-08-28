import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, getApiErrorMessage } from "./api";
import "./tools/tools.css";

const POLL_MS = 3000;

const WAF_TEST_GUIDE = [
  { id: "test-01-normal-home", title: "Pagina principal", method: "GET", target: "/", detail: "Solicita la pagina principal para comprobar trafico legitimo y ausencia de falso positivo.", expected: "Respuesta exitosa sin alerta WAF." },
  { id: "test-public-health", title: "Endpoint de salud", method: "GET", target: "/health", detail: "Consulta el endpoint publico de salud de la aplicacion.", expected: "Respuesta HTTP 200." },
  { id: "test-02-sensitive-env", title: "Archivo de entorno", method: "GET", target: "/.env", detail: "Intenta acceder a un archivo de configuracion sensible.", expected: "HTTP 403 o 404 y nunca contenido sensible." },
  { id: "test-03-sensitive-git", title: "Configuracion Git", method: "GET", target: "/.git/config", detail: "Intenta acceder a metadatos del repositorio.", expected: "HTTP 403 o 404 y nunca contenido del repositorio." },
  { id: "test-05-traversal-path", title: "Recorrido de directorios", method: "GET", target: "Ruta con ../", detail: "Envía una ruta de traversal para comprobar deteccion de acceso fuera del sitio.", expected: "F5 detecta el ataque." },
  { id: "test-07-sqli-query", title: "Inyeccion SQL", method: "GET", target: "Parametro search", detail: "Envía un patron SQL malicioso en una consulta.", expected: "F5 detecta SQL injection." },
  { id: "test-09-xss-script", title: "XSS", method: "GET", target: "Parametro q", detail: "Envía una etiqueta script para comprobar la deteccion de XSS.", expected: "F5 detecta cross-site scripting." },
  { id: "test-11-trace", title: "Metodo TRACE", method: "TRACE", target: "/", detail: "Prueba un metodo HTTP que normalmente no debe estar habilitado.", expected: "HTTP 405 o evento F5." },
  { id: "test-12-delete", title: "Metodo DELETE", method: "DELETE", target: "/", detail: "Comprueba que un metodo destructivo no sea aceptado en la ruta publica.", expected: "HTTP 405 o evento F5." },
  { id: "test-13-options", title: "Politica OPTIONS", method: "OPTIONS", target: "/", detail: "Comprueba la respuesta de preflight y la politica CORS.", expected: "Respuesta acorde con la configuracion." },
  { id: "test-14-tool-user-agent", title: "User-Agent automatizado", method: "GET", target: "/", detail: "Envía un User-Agent de herramienta para validar la politica correspondiente.", expected: "Resultado acorde con la politica configurada." },
  { id: "test-21-rate-limit", title: "Limite de frecuencia", method: "GET", target: "/", detail: "Perfil opcional: envia un conjunto corto y controlado de solicitudes.", expected: "HTTP 429 o evento de limitacion." },
  { id: "test-22-origin-bypass", title: "Acceso directo al origen", method: "GET", target: "IP del origen", detail: "Perfil opcional: intenta evitar el Load Balancer de F5.", expected: "El origen no debe ser accesible desde Internet." },
];

export default function SecurityTestsPage() {
  const [catalog, setCatalog] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [profileKey, setProfileKey] = useState("dry_run");
  const [testKey, setTestKey] = useState("waf");
  const [wafMode, setWafMode] = useState("monitoring");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [selectedAnalysis, setSelectedAnalysis] = useState(null);

  const waf = catalog.find((item) => item.key === "waf");
  const profiles = waf?.profiles || [];
  const analyzedJob = jobs[0] || null;
  const activeTestIndex = WAF_TEST_GUIDE.findIndex(
    (test) => test.id === analyzedJob?.progress?.currentTest,
  );
  const analysisTotal = WAF_TEST_GUIDE.length;
  const analysisCompleted = analyzedJob
    ? analyzedJob.status === "completed"
      ? analysisTotal
      : Math.min(
          analysisTotal,
          Math.max(
            Number(analyzedJob.progress?.completed || 0),
            activeTestIndex >= 0 ? activeTestIndex + 1 : 0,
          ),
        )
    : 0;
  const analysisPercent = Math.round((analysisCompleted / analysisTotal) * 100);

  function getTestSlug(id) {
    return String(id || "").replace(/^test-(\d+-)?/, "");
  }

  function getResultClassName(label) {
    const normalized = String(label || "").toUpperCase();
    if (normalized.includes("ERROR") || normalized.includes("FALL")) return "error";
    if (normalized.includes("REVISAR") || normalized.includes("INCONCLUSIVE")) return "review";
    if (normalized.includes("PAS") || normalized.includes("PASS")) return "completed";
    return "pending";
  }

  function getAnalysisState(test, index) {
    const resultRow = analyzedJob?.result?.rows?.find(
      (row) => row.prueba === test.id || row.test_id === test.id,
    );
    if (resultRow) {
      const responseDetail = String(resultRow.detalle_respuesta || "");
      const f5Detail = String(resultRow.detalle_f5 || "");
      const responseRejected =
        responseDetail.includes("response_f5_rejected") ||
        /request rejected|the requested url was rejected/i.test(
          `${responseDetail} ${f5Detail}`,
        );
      const sensitiveContent = responseDetail.includes("sensitive_content_detected");
      const resultLabel = responseRejected
        ? sensitiveContent
          ? "FALLÓ"
          : "PASÓ"
        : resultRow.resultado || resultRow.result || "Completado";
      return {
        label: resultLabel,
        className: getResultClassName(resultLabel),
          detail: resultRow.que_ocurrio || resultRow.details || "Resultado disponible",
        reason: responseRejected && !sensitiveContent
          ? "La respuesta contiene Request Rejected; F5 bloqueo la solicitud aunque devolviera HTTP 200."
          : resultRow.que_ocurrio || resultRow.details || "El reporte contiene un resultado para este caso.",
      };
    }
    if (["pending", "running"].includes(analyzedJob?.status)) {
      if (index === activeTestIndex) {
        return { label: "En ejecución", className: "running", detail: "Procesando este caso", reason: "La solicitud de este caso se está procesando en el servidor." };
      }
      if (activeTestIndex > index) {
        return { label: "Completado", className: "completed", detail: "Caso procesado", reason: "El servidor ya avanzó al siguiente caso." };
      }
    }
    if (analyzedJob?.status === "completed") {
        return { label: "No reportado", className: "pending", detail: "No aparece en el reporte generado", reason: "La ejecución terminó sin incluir una fila para este caso." };
    }
      if (analyzedJob?.status === "failed" || analyzedJob?.status === "timeout") {
        return { label: "No ejecutado", className: "pending", detail: "La ejecución terminó antes de llegar a este caso", reason: analyzedJob.error?.message || "La ejecución no pudo completar todos los casos." };
      }
      return { label: "Pendiente", className: "pending", detail: "Esperando ejecución", reason: "Este caso todavía no ha sido procesado." };
  }

  function getF5Message(resultRow) {
    if (resultRow?.detalle_f5) return resultRow.detalle_f5;
    if (resultRow?.evento_f5 === "No") {
      return `No se encontró un evento F5 correlacionado. Resultado: ${resultRow.resultado || "sin clasificar"}.`;
    }
    return "No hay mensaje de F5 disponible para este caso.";
  }

  function getResponseDetail(resultRow) {
    if (resultRow?.detalle_respuesta) return resultRow.detalle_respuesta;
    if (resultRow) {
      return `HTTP ${resultRow.http || "desconocido"}; ${resultRow.que_ocurrio || "sin explicación adicional"}.`;
    }
    return "La prueba todavía no genera una respuesta.";
  }

  // Best-effort recovery for JSON messages cut mid-structure (server-side length limits).
  function repairTruncatedJson(rawMessage) {
    if (typeof rawMessage !== "string") return null;
    const stack = [];
    let inString = false;
    let escaped = false;
    let lastSafeIndex = -1;
    let lastSafeStack = null;
    for (let index = 0; index < rawMessage.length; index += 1) {
      const char = rawMessage[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; continue; }
      if (char === "{" || char === "[") stack.push(char === "{" ? "}" : "]");
      else if (char === "}" || char === "]") stack.pop();
      if (char === "," || char === "{" || char === "[") {
        lastSafeIndex = index;
        lastSafeStack = stack.slice();
      }
    }
    if (!lastSafeStack || !lastSafeStack.length) return null;
    const truncated = `${rawMessage.slice(0, lastSafeIndex + 1).replace(/,$/, "")}${lastSafeStack.slice().reverse().join("")}`;
    try {
      return JSON.parse(truncated);
    } catch {
      return null;
    }
  }

  function parseF5Message(rawMessage) {
    let parsed;
    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      parsed = repairTruncatedJson(rawMessage);
    }
    if (!parsed || typeof parsed !== "object") return null;
    const signatures = Array.isArray(parsed.signatures) ? parsed.signatures : [];
    const summaryFields = [
      { label: "País", value: parsed.country },
      { label: "Aplicación", value: parsed.app_type },
      { label: "Cliente", value: parsed.browser_type },
      { label: "Dispositivo", value: parsed.device_type },
      { label: "Riesgo de solicitud", value: parsed.req_risk },
    ].filter((field) => field.value != null && field.value !== "");
    return { summaryFields, signatures, requestId: parsed.req_id };
  }

  function parseF5RejectionMessage(rawMessage) {
    if (typeof rawMessage !== "string" || !/request rejected/i.test(rawMessage)) return null;
    const supportIdMatch = rawMessage.match(/support id is ([a-z0-9-]+)/i);
    const notesMatch = rawMessage.split(";").map((segment) => segment.trim()).filter(Boolean);
    const [firstSegment, ...restSegments] = notesMatch;
    const reason = (firstSegment || rawMessage)
      .replace(/^Respuesta de F5:\s*/i, "")
      .replace(/\s*your support id is [a-z0-9-]+/i, "")
      .replace(/\[go back\]/i, "")
      .trim();
    return {
      reason: reason || "La solicitud fue rechazada por F5.",
      supportId: supportIdMatch ? supportIdMatch[1] : "",
      notes: restSegments,
    };
  }

  function renderF5Message(resultRow) {
    const raw = getF5Message(resultRow);
    const structured = parseF5Message(raw);
    if (structured) {
      return (
        <div className="tools-security-f5-detail">
          {structured.summaryFields.length ? (
            <dl className="tools-security-kv-list">
              {structured.summaryFields.map((field) => (
                <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>
              ))}
            </dl>
          ) : null}
          {structured.signatures.length ? (
            <ul className="tools-security-signature-list">
              {structured.signatures.map((signature, index) => (
                <li key={`${signature.id || index}`}>
                  <strong>{signature.name || signature.attack_type || "Firma sin nombre"}</strong>
                  <span>{[signature.attack_type, signature.risk && `Riesgo: ${signature.risk}`, signature.accuracy && `Precisión: ${signature.accuracy}`].filter(Boolean).join(" · ")}</span>
                  {signature.matching_info ? <small>{signature.matching_info}</small> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      );
    }
    const rejection = parseF5RejectionMessage(raw);
    if (rejection) {
      return (
        <div className="tools-security-f5-detail">
          <p className="tools-security-f5-reason">{rejection.reason}</p>
          {rejection.supportId ? (
            <dl className="tools-security-kv-list">
              <div><dt>Support ID</dt><dd>{rejection.supportId}</dd></div>
            </dl>
          ) : null}
          {rejection.notes.length ? (
            <ul className="tools-security-note-list">
              {rejection.notes.map((note, index) => <li key={index}>{note}</li>)}
            </ul>
          ) : null}
        </div>
      );
    }
    return <pre>{raw}</pre>;
  }

  function parseResponseDetail(rawDetail) {
    if (!rawDetail) return null;
    const segments = rawDetail.split(";").map((segment) => segment.trim()).filter(Boolean);
    const pairs = [];
    const notes = [];
    for (const segment of segments) {
      const separatorIndex = segment.indexOf("=");
      if (separatorIndex > 0) {
        pairs.push({ key: segment.slice(0, separatorIndex), value: segment.slice(separatorIndex + 1) });
      } else {
        notes.push(segment);
      }
    }
    if (!pairs.length && !notes.length) return null;
    return { pairs, notes };
  }

  function renderResponseDetail(resultRow) {
    const raw = getResponseDetail(resultRow);
    const structured = parseResponseDetail(raw);
    if (!structured) return <pre>{raw}</pre>;
    return (
      <div className="tools-security-response-detail">
        {structured.pairs.length ? (
          <dl className="tools-security-kv-list">
            {structured.pairs.map((pair, index) => (
              <div key={`${pair.key}-${index}`}><dt>{pair.key}</dt><dd>{pair.value}</dd></div>
            ))}
          </dl>
        ) : null}
        {structured.notes.length ? (
          <ul className="tools-security-note-list">
            {structured.notes.map((note, index) => <li key={index}>{note}</li>)}
          </ul>
        ) : null}
      </div>
    );
  }

  async function load() {
    const [catalogResponse, jobsResponse] = await Promise.all([
      api.get("/api/tools/security-tests/catalog"),
      api.get("/api/tools/security-tests/jobs"),
    ]);
    setCatalog(catalogResponse.data?.items || []);
    setJobs(jobsResponse.data?.items || []);
  }

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      load()
        .catch((loadError) => {
          if (active) setError(getApiErrorMessage(loadError, "No fue posible cargar las pruebas"));
        })
        .finally(() => active && setLoading(false));
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!jobs.some((job) => ["pending", "running"].includes(job.status))) return undefined;
    const timer = setInterval(() => {
      load().catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [jobs]);

  async function execute() {
    if (testKey !== "waf") return;
    setRunning(true);
    setError("");
    try {
      await api.post("/api/tools/security-tests/jobs", { scriptKey: "waf", profileKey, wafMode });
      await load();
    } catch (executeError) {
      setError(getApiErrorMessage(executeError, "No fue posible iniciar la prueba"));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="panel tools-page tools-security-tests-page">
      <header className="tools-page-header">
        <div>
          <div className="module-title-with-icon"><h2>Pruebas de seguridad</h2></div>
          <p className="roles-subtitle tools-page-subtitle">Ejecuta perfiles controlados para validar el WAF y revisar sus resultados.</p>
          <p className="field-hint"><Link to="/tools">Herramientas</Link> / Pruebas de seguridad</p>
        </div>
      </header>

      {error ? <div className="toast toast-error">{error}</div> : null}

      <article className="tools-security-launch-card">
        <div className="tools-security-test-options" role="list" aria-label="Tipos de pruebas">
          <button type="button" className={`tools-security-test-option ${testKey === "waf" ? "is-selected" : ""}`} onClick={() => setTestKey("waf")}>
            <strong>WAF</strong><span>Disponible</span><small>Valida ataques, rutas sensibles y respuestas del perímetro.</small>
          </button>
          <button type="button" className={`tools-security-test-option ${testKey === "bot_defense" ? "is-selected" : ""}`} onClick={() => setTestKey("bot_defense")}>
            <strong>Bot Defense</strong><span>Próximamente</span><small>Validará perfiles de navegación automatizada y bots.</small>
          </button>
        </div>
        <div className="tools-security-launch-controls">
          {testKey === "waf" ? <><label className="tools-filter-field"><span>Perfil</span><select value={profileKey} onChange={(event) => setProfileKey(event.target.value)} disabled={running || loading}>{profiles.map((profile) => <option key={profile.key} value={profile.key} disabled={!profile.configured}>{profile.title}{!profile.configured ? " (configuracion incompleta)" : ""}</option>)}</select></label>
          <label className="tools-filter-field"><span>Modo WAF</span><select value={wafMode} onChange={(event) => setWafMode(event.target.value)} disabled={running || loading}><option value="monitoring">Monitoreo</option><option value="blocking">Bloqueo</option></select></label>
          <button className="btn-primary" type="button" onClick={execute} disabled={running || loading || !profiles.some((profile) => profile.key === profileKey && profile.configured)}>{running ? "Ejecutando..." : "Ejecutar prueba"}</button></> : <span className="tools-security-planned-message">Bot Defense estará disponible en una siguiente implementación.</span>}
        </div>
      </article>

      <section className="tools-security-analysis">
        <div className="tools-card-heading tools-security-analysis-heading">
          <div>
            <h3>Análisis</h3>
            <p>{analyzedJob ? `Avance de ${analyzedJob.scriptKey} / ${analyzedJob.profileKey}` : "El avance de los casos aparecerá al iniciar una prueba."}</p>
          </div>
          {analyzedJob ? (
            <div className="tools-security-analysis-execution">
              <div className="tools-security-analysis-execution-label">
                <strong>Avance</strong>
                <span>{analysisCompleted} de {analysisTotal} casos · {analysisPercent}%</span>
              </div>
              <div className="tools-security-analysis-execution-track" role="progressbar" aria-valuemin="0" aria-valuemax={analysisTotal} aria-valuenow={analysisCompleted} aria-label="Avance del análisis">
                <span style={{ width: `${analysisPercent}%` }} />
              </div>
              <small>{analyzedJob.status === "completed" ? "Análisis finalizado." : analyzedJob.progress?.currentTest ? `Procesando: ${analyzedJob.progress.currentTest}` : "Preparando análisis..."}</small>
            </div>
          ) : null}
          {analyzedJob ? <span className={`tools-state-pill is-${analyzedJob.status}`}>{analyzedJob.status}</span> : null}
        </div>
        {analyzedJob ? (
          <div className="tools-security-analysis-list">
            {WAF_TEST_GUIDE.map((test, index) => {
              const state = getAnalysisState(test, index);
              const resultRow = analyzedJob?.result?.rows?.find(
                (row) => row.prueba === test.id || row.test_id === test.id,
              );
              return (
                <article className={`tools-security-analysis-item is-${state.className}`} key={test.id}>
                  <span className="tools-security-analysis-marker" aria-hidden="true" />
                  <span className="tools-security-analysis-number">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{test.title}</strong>
                    <span>{getTestSlug(test.id)} · {test.method} · {test.target}</span>
                    <small><b>Resumen:</b> {test.detail}</small>
                    <small><b>Por qué:</b> {state.reason}</small>
                  </div>
                  <b>{state.label}</b>
                  <button
                    className="tools-security-analysis-info"
                    type="button"
                    onClick={() => setSelectedAnalysis({ test, state, resultRow, job: analyzedJob })}
                    title={`Ver detalle de ${test.title}`}
                    aria-label={`Ver detalle de ${test.title}`}
                  >
                    i
                  </button>
                </article>
              );
            })}
          </div>
        ) : <p className="field-hint">No hay una ejecución para analizar.</p>}
      </section>

      {selectedAnalysis ? (
        <div className="tools-security-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSelectedAnalysis(null)}>
          <div className="tools-security-modal tools-security-result-modal" role="dialog" aria-modal="true" aria-labelledby="security-result-title">
            <div className="tools-security-modal-header">
              <div>
                <h3 id="security-result-title">{selectedAnalysis.test.title}</h3>
                <p>{getTestSlug(selectedAnalysis.test.id)} · {selectedAnalysis.test.method} · {selectedAnalysis.test.target}</p>
              </div>
              <button className="btn-secondary" type="button" onClick={() => setSelectedAnalysis(null)}>Cerrar</button>
            </div>
            <div className="tools-security-result-grid">
              <div><span>Resultado</span><strong>{selectedAnalysis.state.label}</strong></div>
              <div><span>HTTP</span><strong>{selectedAnalysis.resultRow?.http || "Pendiente"}</strong></div>
              <div><span>Evento F5</span><strong>{selectedAnalysis.resultRow?.evento_f5 || "Pendiente"}</strong></div>
              <div><span>Acción F5</span><strong>{selectedAnalysis.resultRow?.accion_f5 || "Sin acción registrada"}</strong></div>
              <div><span>Categoría F5</span><strong>{selectedAnalysis.resultRow?.categoria_f5 || "Sin categoría registrada"}</strong></div>
              <div><span>Confianza</span><strong>{selectedAnalysis.resultRow?.confianza_correlacion || "Ninguna"}</strong></div>
            </div>
            <div className="tools-security-result-block"><span>Mensaje F5</span>{renderF5Message(selectedAnalysis.resultRow)}</div>
            <div className="tools-security-result-block"><span>Detalle de respuesta</span>{renderResponseDetail(selectedAnalysis.resultRow)}</div>
            <div className="tools-security-result-meta"><span>ID evento: {selectedAnalysis.resultRow?.id_evento_f5 || "No disponible"}</span><span>ID solicitud: {selectedAnalysis.resultRow?.id_solicitud_f5 || "No disponible"}</span><span>Run ID: {selectedAnalysis.resultRow?.run_id || selectedAnalysis.job?.id || "No disponible"}</span></div>
          </div>
        </div>
      ) : null}

      {loading ? <p className="field-hint">Cargando análisis...</p> : null}
    </section>
  );
}
