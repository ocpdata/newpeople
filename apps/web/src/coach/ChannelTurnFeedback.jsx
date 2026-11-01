import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { api, getApiErrorMessage } from "../api";
import "./channel-turn-feedback.css";

// Thumbs for one answer of the Coach or Cuenta nueva chats. It uses the quality trace each answer already carries.
export function ChannelTurnFeedback({ traceId, channelLabel }) {
  const [rating, setRating] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!traceId) return null;

  async function submit(nextRating) {
    if (submitting || rating) return;
    setSubmitting(true);
    setError("");
    try {
      await api.post(`/api/mi-agent/coach/quality/${traceId}/feedback`, {
        rating: nextRating,
        category: "response",
        corrected: nextRating === "negative",
      });
      setRating(nextRating);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No se pudo registrar tu valoración"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="channel-turn-feedback" aria-label={`Valorar la respuesta de ${channelLabel}`}>
      <span>¿Te sirvió esta respuesta?</span>
      <button
        type="button"
        className={rating === "positive" ? "is-selected" : ""}
        title="Útil y correcta"
        aria-label="Marcar respuesta como útil y correcta"
        disabled={submitting || Boolean(rating)}
        onClick={() => submit("positive")}
      >
        <ThumbsUp size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={rating === "negative" ? "is-selected is-negative" : ""}
        title="Necesita corrección"
        aria-label="Marcar que la respuesta necesita corrección"
        disabled={submitting || Boolean(rating)}
        onClick={() => submit("negative")}
      >
        <ThumbsDown size={15} aria-hidden="true" />
      </button>
      {rating ? (
        <small role="status">{rating === "positive" ? "Gracias, registrado" : "Corrección registrada"}</small>
      ) : null}
      {error ? <small role="alert">{error}</small> : null}
    </div>
  );
}
