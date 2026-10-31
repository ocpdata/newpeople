import { useEffect, useState } from "react";
import "./customer-chat-progress.css";

function useElapsedSeconds(startedAt) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return Math.max(0, Math.floor((now - (startedAt || now)) / 1000));
}

// Shown while a turn is pending: current phase (from the server), elapsed time and a cancel action.
// The ticking timer is hidden from assistive technology so it is not announced every second.
export function CustomerChatProgress({ turn, onCancel, canceling }) {
  const elapsed = useElapsedSeconds(turn.startedAt);
  const uploading = !turn.jobId && Number.isFinite(turn.uploadPercent) && turn.uploadPercent < 100;
  const label = turn.progress?.label || (uploading ? `Subiendo el archivo (${turn.uploadPercent} %)` : "Enviando la pregunta");
  return (
    <div className="mi-agent-customer-chat-progress">
      <span className="mi-agent-customer-chat-progress-spinner" aria-hidden="true" />
      <span className="mi-agent-customer-chat-progress-phase">{label}…</span>
      <span className="mi-agent-customer-chat-progress-elapsed" aria-hidden="true">
        {elapsed} s
      </span>
      <button
        type="button"
        className="mi-agent-secondary-button"
        aria-label="Cancelar pregunta"
        onClick={onCancel}
        disabled={!turn.jobId || canceling}
      >
        {canceling ? "Cancelando..." : "Cancelar"}
      </button>
    </div>
  );
}
