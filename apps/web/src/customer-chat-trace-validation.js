const HTTP_FAILURE_OUTCOMES = new Set([
  "http_error",
  "network_error",
  "timeout",
  "job_failed",
  "invalid_response",
]);
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed"]);
const KNOWN_JOB_STATUSES = new Set(["pending", "running", "completed", "failed"]);

function isValidTimestamp(value) {
  return Number.isFinite(Date.parse(String(value || "")));
}

export function validateCustomerChatObservedFlow({
  events = [],
  exchanges = [],
  hasWorkerTrace = Array.isArray(events) && events.length > 0,
  hasBrowserTrace = Array.isArray(exchanges) && exchanges.length > 0,
} = {}) {
  const checks = [];
  const addCheck = (check) => checks.push(check);
  const spans = new Map();

  for (const event of Array.isArray(events) ? events : []) {
    if (!event?.spanId) {
      addCheck({
        key: `event-without-span-${event?.sequence || checks.length}`,
        state: "error",
        message: "Hay un evento interno sin spanId para enlazar llamada y retorno.",
      });
      continue;
    }
    const span = spans.get(event.spanId) || { calls: [], returns: [] };
    if (event.phase === "call") span.calls.push(event);
    else if (event.phase === "return") span.returns.push(event);
    else {
      addCheck({
        key: `phase-${event.spanId}-${event.sequence || checks.length}`,
        state: "error",
        message: `El span ${event.spanId} tiene una fase no reconocida.`,
        target: { type: "span", id: event.spanId },
      });
    }
    spans.set(event.spanId, span);
  }

  if (!hasWorkerTrace) {
    addCheck({
      key: "worker-trace-unavailable",
      state: "not_checked",
      message: "No hay spans internos para validar; puede ser un turno anterior a la instrumentación.",
    });
  }

  for (const [spanId, span] of spans) {
    const call = span.calls[0];
    const returned = span.returns[0];
    const target = { type: "span", id: spanId };

    if (span.calls.length !== 1 || span.returns.length !== 1) {
      addCheck({
        key: `span-pair-${spanId}`,
        state: "error",
        message:
          span.calls.length !== 1
            ? `El span ${spanId} tiene ${span.calls.length} llamadas; se esperaba una.`
            : `La llamada ${call?.label || spanId} no tiene exactamente un retorno.`,
        target,
      });
    }

    if (call?.parentSpanId && !spans.has(call.parentSpanId)) {
      addCheck({
        key: `span-parent-${spanId}`,
        state: "error",
        message: `El span ${spanId} apunta a un padre que no está en la traza.`,
        target,
      });
    }

    if (call && returned) {
      if (returned.from !== call.to || returned.to !== call.from) {
        addCheck({
          key: `span-direction-${spanId}`,
          state: "error",
          message: `El retorno de ${call.label || spanId} no invierte la dirección de la llamada.`,
          target,
        });
      }
      if (
        Number.isFinite(Number(call.sequence)) &&
        Number.isFinite(Number(returned.sequence)) &&
        Number(returned.sequence) <= Number(call.sequence)
      ) {
        addCheck({
          key: `span-order-${spanId}`,
          state: "error",
          message: `El retorno de ${call.label || spanId} aparece antes de su llamada.`,
          target,
        });
      }
      if (
        !isValidTimestamp(call.at) ||
        !isValidTimestamp(returned.at) ||
        !Number.isFinite(Number(returned.durationMs)) ||
        Number(returned.durationMs) < 0
      ) {
        addCheck({
          key: `span-timing-${spanId}`,
          state: "error",
          message: `El span ${call.label || spanId} tiene timestamps o duración inválidos.`,
          target,
        });
      }
      if (returned.status === "failed") {
        addCheck({
          key: `span-failed-${spanId}`,
          state: "error",
          message: `${call.label || spanId} falló${returned.errorCode ? ` (${returned.errorCode})` : ""}.`,
          target,
        });
      }
    }
  }

  const browserExchanges = Array.isArray(exchanges) ? exchanges : [];
  if (!hasBrowserTrace) {
    addCheck({
      key: "browser-trace-unavailable",
      state: "not_checked",
      message: "No hay intercambios del navegador para validar.",
    });
  }

  browserExchanges.forEach((exchange, index) => {
    if (exchange.kind === "local") return;
    const target = { type: "exchange", id: index };
    const isFailure = HTTP_FAILURE_OUTCOMES.has(exchange.outcome);

    if (isFailure) {
      addCheck({
        key: `http-outcome-${index}`,
        state: "error",
        message: `${exchange.label || exchange.path || "Intercambio HTTP"}: ${exchange.outcome}${exchange.responseSummary?.errorMessage ? ` · ${exchange.responseSummary.errorMessage}` : ""}.`,
        target,
      });
    }

    if (
      !isValidTimestamp(exchange.startedAt) ||
      !isValidTimestamp(exchange.finishedAt) ||
      !Number.isFinite(Number(exchange.durationMs)) ||
      Number(exchange.durationMs) < 0
    ) {
      addCheck({
        key: `http-timing-${index}`,
        state: "error",
        message: `${exchange.label || exchange.path || "Intercambio HTTP"} tiene tiempos incompletos o inválidos.`,
        target,
      });
    }

    if (
      exchange.outcome === "accepted" &&
      (Number(exchange.httpStatus) !== 202 ||
        !Number(exchange.responseSummary?.jobId || 0))
    ) {
      addCheck({
        key: `job-acceptance-${index}`,
        state: "error",
        message: "B2 no confirmó la aceptación del job con HTTP 202 e ID válido.",
        target,
      });
    }

    if (exchange.method === "GET" && exchange.path?.includes("/jobs/")) {
      const pollEvents = Array.isArray(exchange.pollEvents)
        ? exchange.pollEvents
        : [];
      if (Number(exchange.pollCount || 0) !== pollEvents.length) {
        addCheck({
          key: `poll-count-${index}`,
          state: "error",
          message: `El polling declara ${Number(exchange.pollCount || 0)} consultas, pero registra ${pollEvents.length}.`,
          target,
        });
      }

      let terminalSeen = false;
      let previousRank = -1;
      const rank = { pending: 0, running: 1, completed: 2, failed: 2 };
      for (const poll of pollEvents) {
        const status = String(poll.status || "unknown");
        if (!KNOWN_JOB_STATUSES.has(status)) {
          addCheck({
            key: `poll-status-${index}-${poll.attempt}`,
            state: "error",
            message: `El polling devolvió un estado de job desconocido: ${status}.`,
            target,
          });
          continue;
        }
        if (terminalSeen || rank[status] < previousRank) {
          addCheck({
            key: `poll-order-${index}-${poll.attempt}`,
            state: "error",
            message: `La secuencia de estados del job es inválida cerca de ${status}.`,
            target,
          });
        }
        if (TERMINAL_JOB_STATUSES.has(status)) terminalSeen = true;
        previousRank = rank[status];
      }

      const finalStatus = exchange.responseSummary?.finalStatus;
      const lastStatus = pollEvents[pollEvents.length - 1]?.status;
      if (finalStatus && lastStatus && finalStatus !== lastStatus) {
        addCheck({
          key: `poll-final-status-${index}`,
          state: "error",
          message: `El estado final ${finalStatus} no coincide con el último estado observado ${lastStatus}.`,
          target,
        });
      }
      if (
        exchange.outcome === "completed" &&
        (!TERMINAL_JOB_STATUSES.has(lastStatus) ||
          !exchange.responseSummary?.resultReceived)
      ) {
        addCheck({
          key: `poll-result-${index}`,
          state: "error",
          message: "El intercambio terminó como completado, pero no registra estado terminal y resultado recibido.",
          target,
        });
      }
    }
  });

  if (!checks.length) {
    checks.push({
      key: "observed-flow-valid",
      state: "pass",
      message: "Las llamadas, retornos, relaciones y tiempos observados son consistentes.",
    });
  }

  return checks;
}
