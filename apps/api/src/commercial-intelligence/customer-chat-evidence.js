export const CUSTOMER_CHAT_EVIDENCE_LIMITS = Object.freeze({
  maxRounds: 2,
  maxReadQueries: 8,
  maxTurnMs: 45000,
});

export function normalizeCustomerEvidenceAssessment({
  assessment,
  queryCoverage = [],
  readToolResults = [],
  hasQueryErrors = false,
  unqueriedAuthorizedTools = [],
} = {}) {
  if (!assessment || typeof assessment !== "object") return assessment;
  const coveredIntents = new Set(
    (Array.isArray(queryCoverage) ? queryCoverage : [])
      .filter((item) => item?.fullyQueried && item?.intentCode)
      .map((item) => item.intentCode),
  );
  const requestedQueries = Array.isArray(assessment.missingQueries)
    ? [...new Set(assessment.missingQueries.filter(Boolean))]
    : [];
  const missingQueries = requestedQueries.filter(
    (query) => !coveredIntents.has(query),
  );
  const missingFacts = Array.isArray(assessment.missingFacts)
    ? assessment.missingFacts.filter(Boolean)
    : [];
  const hasNonEmptyReadEvidence = (Array.isArray(readToolResults)
    ? readToolResults
    : []
  ).some((item) => {
    if (!item?.toolName || item.error || item.result == null) return false;
    if (Array.isArray(item.result)) return item.result.length > 0;
    if (typeof item.result === "object") {
      return Object.values(item.result).some((value) =>
        Array.isArray(value)
          ? value.length > 0
          : value !== null && value !== undefined && value !== "",
      );
    }
    return true;
  });
  const onlyRepeatedQueries =
    requestedQueries.length > 0 && missingQueries.length === 0;
  const canResolveAsSufficient =
    assessment.status === "incomplete" &&
    onlyRepeatedQueries &&
    missingFacts.length === 0 &&
    hasNonEmptyReadEvidence &&
    !hasQueryErrors &&
    !(Array.isArray(unqueriedAuthorizedTools) &&
      unqueriedAuthorizedTools.length);

  return {
    ...assessment,
    status: canResolveAsSufficient ? "sufficient" : assessment.status,
    missingQueries,
    ...(canResolveAsSufficient ? { clarificationQuestion: "" } : {}),
  };
}

function hasReadQueryError(readToolResults) {
  return readToolResults.some((result) => Boolean(result?.error));
}

function hasSuccessfulRead(readToolResults) {
  return readToolResults.some(
    (result) =>
      result?.toolName &&
      !result.error &&
      result.result !== null &&
      result.result !== undefined,
  );
}

function hasNonEmptyEvidence(readToolResults) {
  return readToolResults.some((item) => {
    if (!item?.toolName || item.error) return false;
    if (Array.isArray(item.result)) return item.result.length > 0;
    if (item.result && typeof item.result === "object") {
      return Object.keys(item.result).some((key) => {
        const value = item.result[key];
        return Array.isArray(value)
          ? value.length > 0
          : value !== null && value !== undefined && value !== "";
      });
    }
    return item.result !== null && item.result !== undefined;
  });
}

function collectToolNames(readToolResults) {
  return new Set(
    readToolResults
      .map((result) => String(result?.toolName || "").trim())
      .filter(Boolean),
  );
}

async function runWithinDeadline(work, remainingMs) {
  if (remainingMs <= 0) {
    const timeoutError = new Error("Customer chat turn deadline exceeded");
    timeoutError.code = "CUSTOMER_CHAT_TURN_TIMEOUT";
    throw timeoutError;
  }
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const timeoutError = new Error(
            "Customer chat turn deadline exceeded",
          );
          timeoutError.code = "CUSTOMER_CHAT_TURN_TIMEOUT";
          reject(timeoutError);
        }, remainingMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runCustomerEvidenceLoop({
  initialReadToolResults = [],
  initialQueryErrors = [],
  unqueriedAuthorizedTools = [],
  assessEvidence,
  fetchAdditionalEvidence,
  onTraceEvent,
  traceParentSpanId = null,
  deadlineAt = Date.now() + CUSTOMER_CHAT_EVIDENCE_LIMITS.maxTurnMs,
  limits = CUSTOMER_CHAT_EVIDENCE_LIMITS,
  now = Date.now,
} = {}) {
  let readToolResults = Array.isArray(initialReadToolResults)
    ? [...initialReadToolResults]
    : [];
  const initialReadQueries = readToolResults.length;
  let rounds = 0;
  let additionalReadQueries = 0;
  let finalStatus = "insufficient_evidence";
  let missingQueries = [];
  let missingFacts = [];
  let clarificationQuestion = "";
  let errorCode = null;
  const failedSources = [
    ...new Set(
      (Array.isArray(initialQueryErrors) ? initialQueryErrors : [])
        .map((item) => String(item?.source || "").trim())
        .filter(Boolean),
    ),
  ];
  const skippedToolNames = [
    ...new Set(
      (Array.isArray(unqueriedAuthorizedTools) ? unqueriedAuthorizedTools : [])
        .map((name) => String(name || "").trim())
        .filter(Boolean),
    ),
  ];
  const trace = (event) => {
    try {
      onTraceEvent?.({ ...event, at: new Date(now()).toISOString() });
    } catch {}
  };
  const hasAnyQueryError = (results) =>
    failedSources.length > 0 || hasReadQueryError(results);

  if (initialReadQueries > limits.maxReadQueries) {
    return {
      status: "query_limit_reached",
      errorCode: "read_query_limit_reached",
      readToolResults: readToolResults.slice(0, limits.maxReadQueries),
      rounds,
      additionalReadQueries,
      missingQueries,
      missingFacts,
      clarificationQuestion,
      failedSources,
      unqueriedAuthorizedTools: skippedToolNames,
    };
  }

  for (;;) {
    const remainingMs = Math.max(0, deadlineAt - now());
    if (!remainingMs) {
      finalStatus = "timeout";
      errorCode = "turn_timeout";
      break;
    }

    let assessment;
    const assessmentStartedAt = now();
    const assessmentSpanId = `evidence-check-${rounds + 1}`;
    trace({
      spanId: assessmentSpanId,
      parentSpanId: traceParentSpanId,
      from: "B9",
      to: "evidence_assessment",
      label: "Verificar evidencia",
      phase: "call",
      status: "started",
      round: rounds,
      input: {
        toolNames: [...collectToolNames(readToolResults)],
        resultCount: readToolResults.length,
        hasQueryErrors: hasAnyQueryError(readToolResults),
      },
    });
    try {
      assessment = await runWithinDeadline(
        () =>
          assessEvidence({
            readToolResults,
            round: rounds,
            remainingMs,
            hasQueryErrors: hasAnyQueryError(readToolResults),
          }),
        remainingMs,
      );
    } catch (error) {
      finalStatus = now() >= deadlineAt ? "timeout" : "verification_error";
      errorCode =
        finalStatus === "timeout"
          ? "turn_timeout"
          : "evidence_verification_failed";
      trace({
        spanId: assessmentSpanId,
        parentSpanId: traceParentSpanId,
        from: "evidence_assessment",
        to: "B9",
        label: "Retorno de verificación",
        phase: "return",
        status: "failed",
        round: rounds,
        durationMs: Math.max(0, now() - assessmentStartedAt),
        errorCode: String(error?.code || error?.name || errorCode).slice(0, 80),
      });
      break;
    }
    if (!assessment) {
      finalStatus = "verification_unavailable";
      errorCode = "evidence_verifier_unavailable";
      trace({
        spanId: assessmentSpanId,
        parentSpanId: traceParentSpanId,
        from: "evidence_assessment",
        to: "B9",
        label: "Retorno de verificación",
        phase: "return",
        status: "unavailable",
        round: rounds,
        durationMs: Math.max(0, now() - assessmentStartedAt),
        errorCode,
      });
      break;
    }

    const status = String(assessment.status || "");
    clarificationQuestion = String(assessment.clarificationQuestion || "")
      .trim()
      .slice(0, 500);
    missingQueries = Array.isArray(assessment.missingQueries)
      ? assessment.missingQueries.slice(0, 8)
      : [];
    missingFacts = Array.isArray(assessment.missingFacts)
      ? assessment.missingFacts
          .slice(0, 8)
          .map((item) =>
            String(item || "")
              .trim()
              .slice(0, 240),
          )
          .filter(Boolean)
      : [];
    const evidenceStatus =
      status === "sufficient" &&
      (!hasNonEmptyEvidence(readToolResults) || missingFacts.length > 0)
        ? "incomplete"
        : status;
    trace({
      spanId: assessmentSpanId,
      parentSpanId: traceParentSpanId,
      from: "evidence_assessment",
      to: "B9",
      label: "Retorno de verificación",
      phase: "return",
      status: "completed",
      round: rounds,
      durationMs: Math.max(0, now() - assessmentStartedAt),
      output: {
        status: evidenceStatus,
        missingQueries,
        missingFacts,
      },
    });

    if (evidenceStatus === "clarification") {
      finalStatus = "clarification";
      break;
    }
    if (
      evidenceStatus === "sufficient" &&
      hasSuccessfulRead(readToolResults) &&
      !skippedToolNames.length &&
      !hasAnyQueryError(readToolResults)
    ) {
      finalStatus = "sufficient";
      break;
    }
    if (
      evidenceStatus === "no_results" &&
      hasSuccessfulRead(readToolResults) &&
      !skippedToolNames.length &&
      !hasAnyQueryError(readToolResults)
    ) {
      finalStatus = "no_results";
      break;
    }

    const normalizedMissingQueries = missingQueries.filter((item) =>
      String(item || "").trim(),
    );
    if (
      rounds >= limits.maxRounds ||
      !normalizedMissingQueries.length ||
      typeof fetchAdditionalEvidence !== "function"
    ) {
      finalStatus = hasAnyQueryError(readToolResults)
        ? "query_error"
        : skippedToolNames.length
          ? "query_limit_reached"
          : "insufficient_evidence";
      errorCode = hasAnyQueryError(readToolResults)
        ? "read_query_failed"
        : !hasSuccessfulRead(readToolResults)
          ? "no_authorized_queries_executed"
          : skippedToolNames.length
            ? "read_query_limit_reached"
            : null;
      break;
    }

    const remainingReadQueries =
      limits.maxReadQueries - initialReadQueries - additionalReadQueries;
    if (remainingReadQueries <= 0) {
      finalStatus = "query_limit_reached";
      errorCode = "read_query_limit_reached";
      break;
    }
    const queryNamesBefore = collectToolNames(readToolResults);
    let additional;
    const additionalReadStartedAt = now();
    const additionalReadSpanId = `additional-evidence-${rounds + 1}`;
    trace({
      spanId: additionalReadSpanId,
      parentSpanId: traceParentSpanId,
      from: "B9",
      to: "B7",
      label: "Solicitar evidencia adicional",
      phase: "call",
      status: "started",
      round: rounds,
      input: {
        missingQueries: normalizedMissingQueries,
        remainingReadQueries,
      },
    });
    try {
      additional = await runWithinDeadline(
        () =>
          fetchAdditionalEvidence({
            missingQueries: normalizedMissingQueries,
            readToolResults,
            remainingReadQueries,
            remainingMs: Math.max(0, deadlineAt - now()),
            traceParentSpanId: additionalReadSpanId,
          }),
        Math.max(0, deadlineAt - now()),
      );
    } catch (error) {
      finalStatus = now() >= deadlineAt ? "timeout" : "query_error";
      errorCode =
        finalStatus === "timeout" ? "turn_timeout" : "additional_read_failed";
      trace({
        spanId: additionalReadSpanId,
        parentSpanId: traceParentSpanId,
        from: "B7",
        to: "B9",
        label: "Retorno de lecturas adicionales",
        phase: "return",
        status: "failed",
        round: rounds,
        durationMs: Math.max(0, now() - additionalReadStartedAt),
        errorCode: String(error?.code || error?.name || errorCode).slice(0, 80),
      });
      break;
    }
    const newResults = Array.isArray(additional?.readToolResults)
      ? additional.readToolResults
      : [];
    const unseenResults = newResults.filter((item) => {
      const toolName = String(item?.toolName || "").trim();
      if (!toolName || queryNamesBefore.has(toolName)) return false;
      queryNamesBefore.add(toolName);
      return true;
    });
    if (!unseenResults.length) {
      finalStatus = hasAnyQueryError(readToolResults)
        ? "query_error"
        : "insufficient_evidence";
      errorCode = hasAnyQueryError(readToolResults)
        ? "read_query_failed"
        : "no_new_authorized_queries";
      trace({
        spanId: additionalReadSpanId,
        parentSpanId: traceParentSpanId,
        from: "B7",
        to: "B9",
        label: "Retorno de lecturas adicionales",
        phase: "return",
        status: "no_new_results",
        round: rounds,
        durationMs: Math.max(0, now() - additionalReadStartedAt),
        output: {
          resultCount: newResults.length,
          toolNames: newResults.map((item) => item.toolName).filter(Boolean),
        },
        errorCode,
      });
      break;
    }
    const boundedResults = unseenResults.slice(0, remainingReadQueries);
    trace({
      spanId: additionalReadSpanId,
      parentSpanId: traceParentSpanId,
      from: "B7",
      to: "B9",
      label: "Retorno de lecturas adicionales",
      phase: "return",
      status: "completed",
      round: rounds,
      durationMs: Math.max(0, now() - additionalReadStartedAt),
      output: {
        resultCount: boundedResults.length,
        toolNames: boundedResults.map((item) => item.toolName).filter(Boolean),
        errorCount: boundedResults.filter((item) => item.error).length,
      },
    });
    readToolResults = [...readToolResults, ...boundedResults];
    additionalReadQueries += boundedResults.length;
    rounds += 1;
  }

  return {
    status: finalStatus,
    errorCode,
    readToolResults,
    rounds,
    additionalReadQueries,
    missingQueries,
    missingFacts,
    clarificationQuestion,
    failedSources,
    unqueriedAuthorizedTools: skippedToolNames,
  };
}
