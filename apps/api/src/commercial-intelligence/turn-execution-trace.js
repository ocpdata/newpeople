export function createTurnExecutionTrace({ enabled = true, now = Date.now } = {}) {
  const events = [];
  let nextSpanId = 0;

  const record = (event) => {
    if (!enabled) return;
    events.push({
      lane: event.lane || "worker",
      ...event,
      sequence: events.length + 1,
      at: event.at || new Date(now()).toISOString(),
    });
  };

  const span = async (
    { from, to, label, lane = "worker", parentSpanId = null, input = null },
    execute,
    summarize = () => null,
  ) => {
    if (!enabled) return execute({ spanId: null });

    const spanId = `turn-span-${++nextSpanId}`;
    const startedAt = now();
    record({
      spanId,
      lane,
      parentSpanId,
      from,
      to,
      label,
      phase: "call",
      status: "started",
      input,
    });

    try {
      const result = await execute({ spanId });
      record({
        spanId,
        lane,
        parentSpanId,
        from: to,
        to: from,
        label,
        phase: "return",
        status: "completed",
        durationMs: Math.max(0, now() - startedAt),
        output: summarize(result),
      });
      return result;
    } catch (error) {
      record({
        spanId,
        lane,
        parentSpanId,
        from: to,
        to: from,
        label,
        phase: "return",
        status: "failed",
        durationMs: Math.max(0, now() - startedAt),
        errorCode: String(error?.code || error?.name || "Error").slice(0, 80),
      });
      throw error;
    }
  };

  const spanSync = (
    { from, to, label, lane = "worker", parentSpanId = null, input = null },
    execute,
    summarize = () => null,
  ) => {
    if (!enabled) return execute({ spanId: null });

    const spanId = `turn-span-${++nextSpanId}`;
    const startedAt = now();
    record({
      spanId,
      lane,
      parentSpanId,
      from,
      to,
      label,
      phase: "call",
      status: "started",
      input,
    });

    try {
      const result = execute({ spanId });
      record({
        spanId,
        lane,
        parentSpanId,
        from: to,
        to: from,
        label,
        phase: "return",
        status: "completed",
        durationMs: Math.max(0, now() - startedAt),
        output: summarize(result),
      });
      return result;
    } catch (error) {
      record({
        spanId,
        lane,
        parentSpanId,
        from: to,
        to: from,
        label,
        phase: "return",
        status: "failed",
        durationMs: Math.max(0, now() - startedAt),
        errorCode: String(error?.code || error?.name || "Error").slice(0, 80),
      });
      throw error;
    }
  };

  return {
    events,
    record,
    span,
    spanSync,
    snapshot: () => events.map((event) => ({ ...event })),
  };
}
