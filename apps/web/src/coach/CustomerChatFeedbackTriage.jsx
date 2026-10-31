import { useEffect, useState } from "react";
import { api, getApiErrorMessage } from "../api";
import { CUSTOMER_CHAT_FEEDBACK_REASONS } from "./customerChatShared";
import "./customer-chat-feedback.css";

const BASE = "/api/commercial-intelligence/account-chat/diagnostics/feedback";
const STATUS_LABELS = { new: "Nuevo", reviewed: "Revisado", dismissed: "Descartado", converted: "Convertido en caso" };
const PAGE_SIZE = 10;

function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString("es-MX") : "";
}

// Triage queue of the seller's thumbs-down reports. Only rendered for users who can see chat diagnostics.
export function CustomerChatFeedbackTriage({ canConvert = false, onOpenDiagnostic }) {
  const [filters, setFilters] = useState({ triageStatus: "new", reasonCode: "all" });
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [notes, setNotes] = useState({});
  const [converting, setConverting] = useState(null);

  // The list is "loading" while the data on screen belongs to a different request key.
  const requestKey = JSON.stringify([page, filters, reloadToken]);
  const loading = result?.requestKey !== requestKey && !error;

  useEffect(() => {
    let active = true;
    api
      .get(BASE, { params: { rating: "negative", page, ...filters } })
      .then(({ data }) => {
        if (!active) return;
        setError("");
        setResult({ ...data, requestKey });
      })
      .catch((requestError) => {
        if (active) setError(getApiErrorMessage(requestError, "No fue posible cargar el feedback"));
      });
    return () => {
      active = false;
    };
  }, [page, filters, reloadToken, requestKey]);

  const reload = () => setReloadToken((value) => value + 1);

  async function changeStatus(item, triageStatus) {
    setBusyId(item.id);
    setError("");
    setNotice("");
    try {
      await api.patch(`${BASE}/${item.id}`, { triageStatus, note: notes[item.id] || null });
      setNotice(`Feedback marcado como ${STATUS_LABELS[triageStatus].toLowerCase()}.`);
      reload();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No fue posible actualizar el feedback"));
    } finally {
      setBusyId(null);
    }
  }

  async function convert(event) {
    event.preventDefault();
    setBusyId(converting.id);
    setError("");
    try {
      const { data } = await api.post(`${BASE}/${converting.id}/convert`, {
        title: converting.title,
        question: converting.question,
        expected: converting.expected,
      });
      setNotice(`Se creó el caso de prueba ${data.evaluationCaseId}. Ya aparece en las evaluaciones.`);
      setConverting(null);
      reload();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No fue posible crear el caso de prueba"));
    } finally {
      setBusyId(null);
    }
  }

  const summary = result?.summary;
  const total = result?.total || 0;
  return (
    <section className="mi-agent-feedback-triage" aria-label="Feedback de respuestas">
      <div className="mi-agent-domain-policy-heading">
        <h4>Feedback de respuestas ({total})</h4>
      </div>
      <p className="field-hint">
        Respuestas que los vendedores marcaron como no útiles. Los comentarios se eliminan automáticamente a los 12 meses.
      </p>
      {summary ? (
        <div className="mi-agent-feedback-triage-summary">
          <span className="mi-agent-feedback-triage-chip"><strong>{summary.negative}</strong> negativas</span>
          <span className="mi-agent-feedback-triage-chip"><strong>{summary.positive}</strong> positivas</span>
          <span className="mi-agent-feedback-triage-chip"><strong>{summary.negativeRatePct}%</strong> de las calificadas son negativas</span>
          <span className="mi-agent-feedback-triage-chip"><strong>{summary.feedbackRatePct}%</strong> de las respuestas se calificaron</span>
          {Object.entries(summary.byReason).map(([code, count]) => (
            <span key={code} className="mi-agent-feedback-triage-chip">
              {CUSTOMER_CHAT_FEEDBACK_REASONS[code] || "Sin motivo"}: <strong>{count}</strong>
            </span>
          ))}
        </div>
      ) : null}
      <div className="mi-agent-feedback-triage-filters">
        <label>
          Estado
          <select
            value={filters.triageStatus}
            onChange={(event) => { setPage(1); setFilters((current) => ({ ...current, triageStatus: event.target.value })); }}
          >
            <option value="all">Todos</option>
            {Object.entries(STATUS_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
        <label>
          Motivo
          <select
            value={filters.reasonCode}
            onChange={(event) => { setPage(1); setFilters((current) => ({ ...current, reasonCode: event.target.value })); }}
          >
            <option value="all">Todos</option>
            {Object.entries(CUSTOMER_CHAT_FEEDBACK_REASONS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
        <button type="button" className="mi-agent-secondary-button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
          Página anterior
        </button>
        <button type="button" className="mi-agent-secondary-button" disabled={page * PAGE_SIZE >= total || loading} onClick={() => setPage(page + 1)}>
          Página siguiente
        </button>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {notice ? <p className="field-hint" role="status">{notice}</p> : null}
      {loading && !result ? <div className="mi-agent-empty">Cargando feedback...</div> : null}
      <div className="mi-agent-feedback-triage-list">
        {(result?.items || []).map((item) => {
          const closed = item.triageStatus !== "new";
          return (
            <article key={item.id} className={`mi-agent-feedback-triage-item${closed ? " is-closed" : ""}`}>
              <div>
                <strong>{CUSTOMER_CHAT_FEEDBACK_REASONS[item.reasonCode] || "Sin motivo"}</strong>
                {" · "}
                <span>{STATUS_LABELS[item.triageStatus]}</span>
                {item.evaluationCaseId ? ` · ${item.evaluationCaseId}` : ""}
              </div>
              <small>
                {item.userName} · {item.accountName || `Cuenta ${item.accountId || "sin asignar"}`} · {formatDateTime(item.createdAt)}
                {item.intent ? ` · ${item.intent}` : ""}
                {item.latencyMs ? ` · ${Math.round(item.latencyMs / 100) / 10} s` : ""}
                {` · Job ${item.jobId}`}
              </small>
              {item.question ? <blockquote><strong>Pregunta:</strong> {item.question}</blockquote> : null}
              {item.answerExcerpt ? <blockquote><strong>Respuesta:</strong> {item.answerExcerpt}</blockquote> : null}
              {item.comment ? <blockquote><strong>Comentario:</strong> {item.comment}</blockquote> : null}
              {item.triageNote ? <small>Nota de revisión ({item.triagedByName || "revisor"}): {item.triageNote}</small> : null}
              {item.triageStatus !== "converted" ? (
                <label>
                  Nota de revisión (opcional)
                  <input
                    type="text"
                    maxLength={500}
                    value={notes[item.id] ?? ""}
                    onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                  />
                </label>
              ) : null}
              <div className="mi-agent-feedback-triage-actions">
                {item.triageStatus === "new" ? (
                  <>
                    <button type="button" className="mi-agent-secondary-button" disabled={busyId === item.id} onClick={() => void changeStatus(item, "reviewed")}>
                      Marcar revisado
                    </button>
                    <button type="button" className="mi-agent-secondary-button" disabled={busyId === item.id} onClick={() => void changeStatus(item, "dismissed")}>
                      Descartar
                    </button>
                  </>
                ) : null}
                {["reviewed", "dismissed"].includes(item.triageStatus) ? (
                  <button type="button" className="mi-agent-secondary-button" disabled={busyId === item.id} onClick={() => void changeStatus(item, "new")}>
                    Reabrir
                  </button>
                ) : null}
                {canConvert && item.triageStatus !== "converted" && item.accountId ? (
                  <button
                    type="button"
                    className="mi-agent-secondary-button"
                    onClick={() => setConverting({
                      id: item.id,
                      title: `Feedback: ${String(item.question || "respuesta").slice(0, 80)}`,
                      question: item.question,
                      expected: "",
                    })}
                  >
                    Convertir en caso de prueba
                  </button>
                ) : null}
                <button type="button" className="mi-agent-secondary-button" onClick={() => onOpenDiagnostic?.(item.jobId)}>
                  Abrir diagnóstico
                </button>
              </div>
              {converting?.id === item.id ? (
                <form className="mi-agent-feedback-triage-convert" onSubmit={convert} aria-label="Crear caso de prueba">
                  <label>
                    Título
                    <input type="text" required minLength={3} maxLength={200} value={converting.title}
                      onChange={(event) => setConverting({ ...converting, title: event.target.value })} />
                  </label>
                  <label>
                    Pregunta a evaluar
                    <textarea rows={2} required minLength={3} maxLength={2000} value={converting.question}
                      onChange={(event) => setConverting({ ...converting, question: event.target.value })} />
                  </label>
                  <label>
                    Resultado esperado
                    <textarea rows={3} required minLength={10} maxLength={2000} value={converting.expected}
                      placeholder="Qué debería responder o hacer el chat para considerarse correcto"
                      onChange={(event) => setConverting({ ...converting, expected: event.target.value })} />
                  </label>
                  <small>El caso se ejecutará contra la cuenta de este feedback y requerirá revisión humana.</small>
                  <div className="mi-agent-feedback-triage-actions">
                    <button type="submit" className="mi-agent-primary-button" disabled={busyId === item.id}>Crear caso</button>
                    <button type="button" className="mi-agent-secondary-button" onClick={() => setConverting(null)}>Cancelar</button>
                  </div>
                </form>
              ) : null}
            </article>
          );
        })}
        {!loading && result && !result.items.length ? (
          <div className="mi-agent-empty">No hay feedback para esos filtros.</div>
        ) : null}
      </div>
    </section>
  );
}
