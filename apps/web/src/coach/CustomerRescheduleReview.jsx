import { useState } from "react";
import { api, getApiErrorMessage } from "../api";

export function CustomerRescheduleSummary({ summary }) {
  if (!summary) return null;
  if (!summary.after) return <p>Propuesta pendiente de aclaración; no guardada.</p>;
  return (
    <div>
      <p>{summary.accountName} · {summary.opportunityName} · {summary.activityTitle}</p>
      <p>Programación actual: {summary.before || "(sin programación)"}</p>
      <p>Programación propuesta: {summary.after}</p>
      <p>Zona horaria: {summary.timeZone}</p>
    </div>
  );
}

export function CustomerRescheduleReview({ handoff, token, onSaved, canSave }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const operation = handoff?.payload;
  if (operation?.kind !== "reschedule_activity") return null;
  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await api.post(`/api/opportunities/${operation.opportunityId}/coach-reschedule`, { token, version: handoff.version });
      if (response.data?.operation?.status !== "completed") throw new Error("El servidor no confirmó la reprogramación");
      await onSaved();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No fue posible reprogramar. Vuelve al chat y revisa la actividad vigente."));
    } finally { setSaving(false); }
  }
  return (
    <section className="card" aria-label="Revisar reprogramación">
      <h3>Reprogramación · propuesta no guardada</h3>
      <CustomerRescheduleSummary summary={operation.scheduleSummary} />
      <p>Se conservará la misma actividad (ID {operation.activityId}). Solo cambiará su programación; no se creará otra actividad.</p>
      <p>Para corregir o descartar la propuesta, vuelve al chat.</p>
      {error ? <p role="alert">{error}</p> : null}
      <button type="button" className="btn-primary" disabled={!canSave || saving} onClick={save}>
        {saving ? "Guardando reprogramación..." : "Confirmar y reprogramar"}
      </button>
    </section>
  );
}
