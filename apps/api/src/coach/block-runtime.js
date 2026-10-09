export const COACH_BLOCK_LIMITS = Object.freeze({
  maxTurnMs: 45000,
  maxReadQueries: 8,
  maxEvidenceRounds: 2,
});

export function createCoachBlockTrace({ jobId, now = Date.now } = {}) {
  const events = [];
  let sequence = 0;
  return {
    events,
    record(event) {
      events.push({
        channel: "coach",
        jobId: Number(jobId) || null,
        sequence: ++sequence,
        at: new Date(now()).toISOString(),
        ...event,
      });
    },
    async span(from, to, label, work, summary = () => ({})) {
      const spanId = `coach-${jobId || "turn"}-${sequence + 1}`;
      const startedAt = now();
      this.record({
        from,
        to,
        label,
        spanId,
        phase: "call",
        status: "started",
      });
      try {
        const value = await work();
        this.record({
          from: to,
          to: from,
          label,
          spanId,
          phase: "return",
          status: "completed",
          durationMs: now() - startedAt,
          output: summary(value),
        });
        return value;
      } catch (error) {
        this.record({
          from: to,
          to: from,
          label,
          spanId,
          phase: "return",
          status: "failed",
          durationMs: now() - startedAt,
          errorCode: String(error.code || error.name || "block_failed"),
        });
        throw error;
      }
    },
  };
}

export async function withCoachDeadline(work, deadlineAt) {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0)
    throw Object.assign(
      new Error("El turno de Coach excedió el tiempo disponible"),
      { code: "coach_turn_timeout" },
    );
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise((resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Object.assign(
                new Error("El turno de Coach excedió el tiempo disponible"),
                { code: "coach_turn_timeout" },
              ),
            ),
          remainingMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function summarizeCoachEvidence(results = []) {
  return results.map((item) => ({
    toolName: item.toolName,
    queryFailed: Boolean(item.error),
    resultCount: Array.isArray(item.result)
      ? item.result.length
      : item.result
        ? 1
        : 0,
    truncated: Boolean(item.truncated),
  }));
}

export function hasCoachEvidence(results = []) {
  return results.some(
    (item) =>
      !item.error &&
      (Array.isArray(item.result)
        ? item.result.length > 0
        : item.result && typeof item.result === "object"
          ? Object.keys(item.result).length > 0
          : Boolean(item.result)),
  );
}

export function coachBlockFailure(
  message,
  responseType = "error",
  missing = [],
) {
  return {
    intent: "clarification",
    responseType,
    answer: message,
    confidence: "low",
    evidence: [],
    facts: [],
    inferences: [],
    pendingItems: missing,
    operations: [],
    recommendation: null,
    toolCalls: [],
    ...(responseType === "clarification"
      ? {
          clarification: {
            type: "missing_fields",
            message,
            missing,
            candidates: [],
          },
        }
      : {}),
  };
}
