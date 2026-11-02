export const COACH_BLOCK_LIMITS = Object.freeze({
  maxTurnMs: 45000,
  maxReadQueries: 8,
  maxEvidenceRounds: 2,
});

export function createCoachBlockTrace({ jobId, now = Date.now, onEvent } = {}) {
  const events = [];
  let sequence = 0;
  return {
    events,
    record(event) {
      const entry = {
        channel: "coach",
        jobId: Number(jobId) || null,
        sequence: ++sequence,
        at: new Date(now()).toISOString(),
        ...event,
      };
      events.push(entry);
      try {
        onEvent?.(entry);
      } catch {
        // Observers are informational and must never affect the turn.
      }
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

// MySQL returns DATE columns as Date objects; the response contract expects plain yyyy-mm-dd strings.
export function serializeCoachDates(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (Array.isArray(value)) return value.map(serializeCoachDates);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeCoachDates(item)]),
    );
  }
  return value;
}

const FACT_SOURCE_BY_TOOL = [
  [/quotation/i, "quotation"],
  [/activit/i, "activity"],
  [/opportunit|pipeline/i, "opportunity"],
  [/account/i, "account"],
  [/contact/i, "contact"],
  [/lead/i, "lead"],
];

// Facts describing what the server actually read, for answers whose model listed none. They state the reads
// and their size only; the answer audit still decides whether the answer is supported by them.
export function buildCoachEvidenceFacts(results = [], limit = 5) {
  return results
    .filter((item) => !item.error && hasCoachEvidence([item]))
    .slice(0, limit)
    .map((item) => {
      const count = Array.isArray(item.result) ? item.result.length : 1;
      return {
        sourceType:
          FACT_SOURCE_BY_TOOL.find(([pattern]) => pattern.test(item.toolName))?.[1] ||
          "crm_context",
        sourceId: null,
        label: `Lectura autorizada: ${item.toolName}`,
        excerpt: `${count} registro(s) leído(s) del CRM para responder esta pregunta.`,
      };
    });
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
