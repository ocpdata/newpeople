import { useId, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { getApiErrorMessage } from "../api";
import { CUSTOMER_CHAT_FEEDBACK_REASONS } from "./customerChatShared";
import "./customer-chat-feedback.css";

// Lets the seller rate one answer. A thumbs-up is sent right away; a thumbs-down asks what failed
// so reviewers can sort the reports.
export function CustomerChatFeedback({ jobId, feedback, onSubmit }) {
  const formId = useId();
  const [formOpen, setFormOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function send(payload) {
    setSaving(true);
    setError("");
    try {
      await onSubmit(jobId, payload);
      setFormOpen(false);
      setReasonCode("");
      setComment("");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No se pudo enviar tu opinión"));
    } finally {
      setSaving(false);
    }
  }

  const rating = feedback?.rating || null;
  return (
    <div className="mi-agent-customer-chat-feedback" role="group" aria-label="Opinión sobre esta respuesta">
      <span>¿Te sirvió esta respuesta?</span>
      <button
        type="button"
        className="mi-agent-customer-chat-feedback-button"
        aria-label="Sí me sirvió"
        aria-pressed={rating === "positive"}
        disabled={saving}
        onClick={() => {
          setFormOpen(false);
          void send({ rating: "positive" });
        }}
      >
        <ThumbsUp size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="mi-agent-customer-chat-feedback-button"
        aria-label="No me sirvió"
        aria-pressed={rating === "negative"}
        aria-expanded={formOpen}
        aria-controls={formId}
        disabled={saving}
        onClick={() => setFormOpen((open) => !open)}
      >
        <ThumbsDown size={16} aria-hidden="true" />
      </button>
      <span className="mi-agent-customer-chat-feedback-status" aria-live="polite">
        {rating ? "Gracias, tu opinión quedó registrada." : ""}
      </span>
      {formOpen ? (
        <form
          id={formId}
          className="mi-agent-customer-chat-feedback-form"
          onSubmit={(event) => {
            event.preventDefault();
            void send({ rating: "negative", reasonCode, comment: comment.trim() || null });
          }}
        >
          <label>
            ¿Qué falló?
            <select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} required>
              <option value="">Selecciona un motivo</option>
              {Object.entries(CUSTOMER_CHAT_FEEDBACK_REASONS).map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            Comentario (opcional)
            <textarea
              rows={2}
              maxLength={1000}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </label>
          <small>
            Solo lo ven quienes revisan diagnósticos y se elimina a los 12 meses. No incluyas contraseñas ni datos sensibles.
          </small>
          <div className="mi-agent-customer-chat-feedback-actions">
            <button type="submit" className="mi-agent-primary-button" disabled={saving || !reasonCode}>
              {saving ? "Enviando..." : "Enviar opinión"}
            </button>
            <button type="button" className="mi-agent-secondary-button" disabled={saving} onClick={() => setFormOpen(false)}>
              Cancelar
            </button>
          </div>
        </form>
      ) : null}
      {error ? <small className="form-error" role="alert">{error}</small> : null}
    </div>
  );
}
