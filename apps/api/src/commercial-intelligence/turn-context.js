import { AsyncLocalStorage } from "node:async_hooks";

// A chat turn makes several provider calls spread over many modules. Instead of threading a signal and
// counters through all of them, the turn runs inside this context and every provider call reads it.
const storage = new AsyncLocalStorage();

export const TURN_CANCELLED_CODE = "turn_cancelled";
export const TURN_BUDGET_CODE = "CUSTOMER_TURN_BUDGET_EXCEEDED";

const activeTurns = new Map();

export function cancelledTurnError() {
  return Object.assign(new Error("Turno cancelado por el usuario"), { code: TURN_CANCELLED_CODE });
}

export function budgetExceededError(reason) {
  const message = reason === "time"
    ? "La solicitud tardó más de lo permitido y se detuvo. Intenta con una pregunta más específica."
    : "La solicitud requirió demasiados pasos y se detuvo para proteger el costo. Intenta con una pregunta más específica.";
  return Object.assign(new Error(message), { code: TURN_BUDGET_CODE, budgetReason: reason });
}

export function runWithTurnContext({ jobId = null, maxLlmCalls = Infinity, maxDurationMs = 0 } = {}, work) {
  const controller = new AbortController();
  const context = { jobId, controller, maxLlmCalls, llmCalls: 0, timer: null };
  if (maxDurationMs > 0) {
    context.timer = setTimeout(() => controller.abort(budgetExceededError("time")), maxDurationMs);
    context.timer.unref?.();
  }
  if (jobId !== null) activeTurns.set(Number(jobId), context);
  return storage.run(context, async () => {
    try {
      return await work(controller.signal);
    } finally {
      clearTimeout(context.timer);
      if (jobId !== null && activeTurns.get(Number(jobId)) === context) activeTurns.delete(Number(jobId));
    }
  });
}

// Aborts the in-flight provider calls of a turn running in this process; returns whether one was found.
export function abortActiveTurn(jobId) {
  const context = activeTurns.get(Number(jobId));
  if (!context || context.controller.signal.aborted) return false;
  context.controller.abort(cancelledTurnError());
  return true;
}

export function currentTurnSignal() {
  return storage.getStore()?.controller.signal || null;
}

// The error that explains why the turn was aborted, or null while it can continue.
export function turnAbortError() {
  const signal = currentTurnSignal();
  if (!signal?.aborted) return null;
  return signal.reason?.code ? signal.reason : cancelledTurnError();
}

// Counts a provider call against the turn budget; throws when the turn was aborted or used up its calls.
export function registerProviderCall() {
  const context = storage.getStore();
  if (!context) return;
  const aborted = turnAbortError();
  if (aborted) throw aborted;
  context.llmCalls += 1;
  if (context.llmCalls > context.maxLlmCalls) {
    const error = budgetExceededError("calls");
    context.controller.abort(error);
    throw error;
  }
}

export function turnCallCount() {
  return storage.getStore()?.llmCalls ?? 0;
}
