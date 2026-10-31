import { useRef, useState } from "react";
import { api, getApiErrorMessage } from "../api";
import { CHAT_OPERATION_FIELD_LABELS, formatChatOperationValue } from "./customerChatShared";

const COACH = "/api/mi-agent/coach/operations";

// Confirms a note or an opportunity data change without leaving the chat. Nothing is written until the
// seller presses the confirm button, and only after the server has re-read the current value.
export function CustomerChatOperationCard({ operation, accountId, chatSessionId, onOutcome }) {
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [observed, setObserved] = useState(null);
  const persistedRef = useRef(null);
  const keyRef = useRef(null);
  const completedRef = useRef(null);
  const isNote = operation.kind === "opportunity_note";
  const busy = ["reviewing", "confirming", "discarding", "undoing"].includes(state);

  async function run(nextState, work) {
    setState(nextState);
    setError("");
    try {
      await work();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "No fue posible completar la operación"));
      setState(persistedRef.current ? "ready" : "idle");
    }
  }

  const review = () => run("reviewing", async () => {
    setNotice("");
    if (!persistedRef.current) {
      const { data } = await api.post(COACH, {
        sessionId: null,
        originChannel: "customer_account",
        originalIntent: `Propuesta desde Cliente existente: ${operation.title || operation.kind}`,
        context: { accountId: Number(accountId || 0) || null, opportunityId: Number(operation.opportunityId || 0) || null, contactId: null, leadId: null },
        operation: { ...operation, requiresConfirmation: true },
      });
      persistedRef.current = data?.operation;
    }
    const current = persistedRef.current;
    const { data } = await api.post(`${COACH}/${current.id}/review`, { version: current.version });
    if (!data?.operation) throw new Error("No fue posible revisar el valor actual");
    persistedRef.current = data.operation;
    keyRef.current = crypto.randomUUID();
    setObserved(data.operation.pendingOperation || {});
    setState("ready");
  });

  const confirm = () => run("confirming", async () => {
    const current = persistedRef.current;
    const { data } = await api.post(`${COACH}/${current.id}/execute`, {
      version: current.version, idempotencyKey: keyRef.current, confirmedVia: "customer_chat", chatSessionId: Number(chatSessionId || 0),
    });
    // Saved means the server says so; a missing confirmation is never shown as done.
    if (data?.operation?.status !== "completed") {
      throw new Error("El servidor no confirmó la ejecución del cambio. No se acredita como guardado.");
    }
    completedRef.current = data.operation;
    onOutcome(operation.signature, "confirmed");
    setState("done");
  });

  const discard = () => run("discarding", async () => {
    await api.post(`${COACH}/${persistedRef.current.id}/reject`, { reason: "Descartada desde el chat", chatSessionId: Number(chatSessionId || 0) });
    onOutcome(operation.signature, "discarded");
  });

  const undo = () => run("undoing", async () => {
    await api.post(`${COACH}/${completedRef.current.id}/revert`, { chatSessionId: Number(chatSessionId || 0) });
    persistedRef.current = null;
    completedRef.current = null;
    setObserved(null);
    setNotice("Cambio deshecho. Puedes volver a revisarlo.");
    onOutcome(operation.signature, null);
    setState("idle");
  });

  if (operation.outcome === "confirmed" && state !== "done") return <small>Confirmado y guardado desde el chat.</small>;
  if (operation.outcome === "discarded") return <small>Descartado desde el chat.</small>;

  const currentValue = observed && Object.hasOwn(observed, "currentValue") ? observed.currentValue : operation.currentValue;
  const sameValue = !isNote && observed && String(currentValue ?? "") === String(operation.value ?? "");
  const label = CHAT_OPERATION_FIELD_LABELS[operation.field] || operation.field;

  return (
    <div className="mi-agent-customer-operation-card">
      {state === "done" ? (
        <>
          <p aria-live="polite">{isNote ? "Nota registrada en la oportunidad." : "Cambio guardado en la oportunidad."}</p>
          {!isNote ? (
            <button type="button" className="mi-agent-link-button" disabled={busy} onClick={undo}>Deshacer cambio</button>
          ) : null}
        </>
      ) : (
        <>
          {state === "ready" || state === "confirming" || state === "discarding" ? (
            <div className="mi-agent-customer-operation-review">
              {isNote ? (
                <p>Se registrará esta nota en la oportunidad: «{operation.noteText}»</p>
              ) : (
                <p>
                  {label}: <span>{formatChatOperationValue(operation.field, currentValue)}</span>
                  {" → "}<strong>{formatChatOperationValue(operation.field, operation.value)}</strong>
                </p>
              )}
              {sameValue ? <small>El valor actual ya coincide con el propuesto; no hay nada que confirmar.</small> : null}
              <div className="mi-agent-customer-operation-actions">
                <button type="button" className="mi-agent-primary-button" disabled={busy || sameValue} onClick={confirm}>
                  {state === "confirming" ? "Guardando…" : isNote ? "Registrar nota" : "Confirmar cambio"}
                </button>
                <button type="button" className="mi-agent-secondary-button" disabled={busy} onClick={discard}>
                  {state === "discarding" ? "Descartando…" : "Descartar"}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="mi-agent-link-button" disabled={busy} onClick={review}>
              {state === "reviewing" ? "Revisando el valor actual…" : "Revisar y confirmar aquí"}
            </button>
          )}
        </>
      )}
      {notice ? <small aria-live="polite">{notice}</small> : null}
      {error ? <small className="form-error" aria-live="assertive">{error}</small> : null}
    </div>
  );
}
