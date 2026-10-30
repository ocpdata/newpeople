import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { api, getApiErrorMessage } from "../api";

const SHOW_COACH_QUALITY_FEEDBACK = false;

export function CoachQualityFeedback({ traceId }) {
  const [category, setCategory] = useState("response");
  const [submittedRating, setSubmittedRating] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");
  const categoryDescriptions = {
    intent: "¿Entendió qué estabas pidiendo?",
    entity: "¿Identificó la cuenta, oportunidad o persona correcta?",
    response: "¿La respuesta fue clara y resolvió tu pregunta?",
    evidence: "¿Los datos y las fuentes respaldan lo que respondió?",
    other: "¿Hay otro problema que no encaja en las categorías anteriores?",
  };

  async function submit(rating) {
    if (!traceId || submitting) return;
    setSubmitting(true);
    setFeedbackError("");
    try {
      await api.post(`/api/mi-agent/coach/quality/${traceId}/feedback`, {
        rating,
        category,
        corrected: rating === "negative",
      });
      setSubmittedRating(rating);
    } catch (requestError) {
      setFeedbackError(
        getApiErrorMessage(requestError, "No se pudo registrar el feedback"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!SHOW_COACH_QUALITY_FEEDBACK || !traceId) return null;
  return (
    <div
      className="mi-agent-quality-feedback"
      aria-label="Evaluar respuesta del Coach"
    >
      <div className="mi-agent-quality-feedback-copy">
        <strong>¿Cómo evalúas esta respuesta?</strong>
        <label>
          <span>Aspecto</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            disabled={submitting || Boolean(submittedRating)}
          >
            <option value="intent">Interpretación de la solicitud</option>
            <option value="entity">Identificación del registro</option>
            <option value="response">
              Claridad y utilidad de la respuesta
            </option>
            <option value="evidence">Exactitud de datos y evidencia</option>
            <option value="other">Otro aspecto</option>
          </select>
        </label>
        <small>{categoryDescriptions[category]}</small>
      </div>
      <div
        className="mi-agent-quality-feedback-actions"
        aria-label="Calificación"
      >
        <button
          type="button"
          className={submittedRating === "positive" ? "is-selected" : ""}
          title="Útil y correcta"
          aria-label="Marcar respuesta como útil y correcta"
          disabled={submitting || Boolean(submittedRating)}
          onClick={() => submit("positive")}
        >
          <ThumbsUp size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={submittedRating === "negative" ? "is-selected" : ""}
          title="Necesita corrección"
          aria-label="Marcar que la respuesta necesita corrección"
          disabled={submitting || Boolean(submittedRating)}
          onClick={() => submit("negative")}
        >
          <ThumbsDown size={16} aria-hidden="true" />
        </button>
        {submittedRating ? (
          <small className="mi-agent-quality-feedback-status" role="status">
            {submittedRating === "positive"
              ? "Gracias, registrado"
              : "Corrección registrada"}
          </small>
        ) : null}
        {feedbackError ? (
          <small className="mi-agent-quality-feedback-error" role="alert">
            {feedbackError}
          </small>
        ) : null}
      </div>
    </div>
  );
}
