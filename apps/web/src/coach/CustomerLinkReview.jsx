import { useState } from "react";
import { api, getApiErrorMessage } from "../api";

export function CustomerLinkReview({ handoff, token, onSaved, canSave }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const operation = handoff?.payload;
  if (!operation?.linkDraftId) return null;
  const summary = operation.linkSummary;
  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await api.post(`/api/opportunities/${operation.opportunityId}/coach-contact`, {
        token, version: handoff.version,
      });
      if (response.data?.operation?.status !== "completed") throw new Error("El servidor no confirmó el guardado del vínculo");
      await onSaved();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No fue posible guardar el vínculo. Vuelve al chat y revisa la relación vigente."));
    } finally { setSaving(false); }
  }
  return (
    <section className="card" aria-label="Revisar vínculo contacto-oportunidad">
      <h3>Revisar vínculo · propuesta no guardada</h3>
      <p>{summary.accountName} · {summary.opportunityName}</p>
      <p>Contacto actual: {summary.currentContactName || "(sin contacto)"}</p>
      <p>Contacto propuesto: {summary.contactName}</p>
      <p>{summary.effect === "replace"
        ? "Se sustituirá el contacto asociado. No se conservarán ambos contactos."
        : "Se asignará el contacto propuesto a la oportunidad."}</p>
      <p>Solo se guardará esta asociación. Para corregirla, vuelve al chat; no uses la edición general como confirmación de este borrador.</p>
      {error ? <p role="alert">{error}</p> : null}
      <button type="button" className="btn-primary" disabled={!canSave || saving} onClick={save}>
        {saving ? "Guardando vínculo..." : "Confirmar y guardar vínculo"}
      </button>
    </section>
  );
}
