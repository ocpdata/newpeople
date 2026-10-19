import { useEffect, useState } from "react";
import { api, getApiErrorMessage } from "../api";

export function CustomerStageSummary({ summary }) {
  if (!summary?.targetStageName) return null;
  return <section aria-label="Solicitud de validación de avance">
    <h4>{summary.accountName} · {summary.opportunityName}</h4>
    <p>Etapa actual: {summary.currentStageName}</p>
    <p>Siguiente etapa: {summary.targetStageName}</p>
    <p>No se validó ni cambió la etapa al preparar o trasladar esta solicitud.</p>
    <p>La validación con IA de Oportunidades mantiene sus reglas y puede avanzar automáticamente si su resultado lo determina. Tener todas las respuestas no garantiza aprobación.</p>
  </section>;
}

export function CustomerStageReview({ handoff, token, canValidate, onOpenOpportunity, onFinished }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [state, setState] = useState(null);
  const [refreshId, setRefreshId] = useState(0);
  const operation = handoff?.payload;
  const eligible = operation?.kind === "validate_stage";
  const path = eligible ? `/api/opportunities/${operation.opportunityId}/coach-stage-validation` : "";
  useEffect(() => {
    if (!eligible) return;
    let stopped = false, timer;
    async function refresh() {
      try {
        const { data } = await api.get(`${path}/${token}`);
        if (stopped) return;
        if (!data.operation) throw new Error("No se recibió el estado de la solicitud");
        setState(data);
        if (data.operation.status !== "completed" && data.validation && !data.validation.error) {
          timer = setTimeout(refresh, data.validation.job?.pollAfterMs || 3000);
        }
      } catch (requestError) {
        if (!stopped) setError(getApiErrorMessage(requestError, "No fue posible recuperar la validación. No la inicies otra vez sin revisar su estado."));
      }
    }
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [eligible, path, token, busy, refreshId]);
  if (!eligible) return null;
  async function start() {
    setBusy(true); setError("");
    try {
      const { data } = await api.post(path, { token, version: state?.operation?.version || handoff.version });
      if (!data.job?.id) throw new Error("El validador no confirmó el trabajo. Revisa su estado antes de volver a intentarlo.");
      setState((previous) => ({ ...previous, validation: data }));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No fue posible solicitar la validación de la etapa"));
    } finally { setBusy(false); }
  }
  const started = Boolean(state?.operation?.result?.validationJobId || state?.validation?.job?.id);
  return <section className="card" aria-label="Validar avance desde Mi Coach">
    <CustomerStageSummary summary={operation.stageSummary} />
    {state?.operation?.status === "completed" ? <section aria-label="Resultado de validación">
      <h4>{state.operation.result.outcome === "advanced" ? "Etapa avanzada" : "Validación terminada"}</h4>
      <p>{state.validation?.result?.message}</p>
      <p>{state.validation?.result?.validation?.summary}</p>
      <ul>{(state.validation?.result?.validation?.reasons || []).map((reason, index) => <li key={index}>{reason}</li>)}</ul>
      {state.operation.result.outcome === "stage_changed_after_validation" ? <p>La etapa actual ya es distinta de la registrada en este resultado.</p> : null}
      <button type="button" onClick={() => { void onFinished(state.operation.result).catch((requestError) =>
        setError(getApiErrorMessage(requestError, "No fue posible actualizar la vista"))); }}>Cerrar resultado</button>
    </section> : null}
    <p>Se evaluarán las respuestas y documentos guardados con el mismo validador del módulo. No se aplicará bypass, salto de etapa ni una aprobación alternativa.</p>
    <button type="button" onClick={async () => {
      try { await onOpenOpportunity(operation.opportunityId); }
      catch (requestError) { setError(getApiErrorMessage(requestError, "No fue posible abrir las respuestas")); }
    }}>Revisar respuestas en Oportunidades</button>
    {!started ? <button type="button" disabled={!canValidate || busy || !state || Boolean(error)} onClick={start}>
      {busy ? "Solicitando validación..." : "Solicitar validación con IA (puede avanzar)"}
    </button> : <p role="status">Trabajo vinculado: {state?.validation?.job?.status || "en proceso"}. No se iniciará otra validación desde esta propuesta.</p>}
    {state?.validation?.error ? <p role="alert">{state.validation.error.message} Retoma el chat para preparar otra solicitud; no se reintentará automáticamente.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {error ? <button type="button" disabled={busy} onClick={() => {
      setState(null); setError(""); setRefreshId((value) => value + 1);
    }}>Consultar estado nuevamente</button> : null}
  </section>;
}
