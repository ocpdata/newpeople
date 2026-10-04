export const CUSTOMER_CHAT_EVIDENCE_LIMITS = Object.freeze({
  maxRounds: 2,
  maxReadQueries: 8,
  maxTurnMs: 18000,
});

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
    } catch {
      finalStatus = now() >= deadlineAt ? "timeout" : "verification_error";
      errorCode =
        finalStatus === "timeout"
          ? "turn_timeout"
          : "evidence_verification_failed";
      break;
    }
    if (!assessment) {
      finalStatus = "verification_unavailable";
      errorCode = "evidence_verifier_unavailable";
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
    try {
      additional = await runWithinDeadline(
        () =>
          fetchAdditionalEvidence({
            missingQueries: normalizedMissingQueries,
            readToolResults,
            remainingReadQueries,
            remainingMs: Math.max(0, deadlineAt - now()),
          }),
        Math.max(0, deadlineAt - now()),
      );
    } catch {
      finalStatus = now() >= deadlineAt ? "timeout" : "query_error";
      errorCode =
        finalStatus === "timeout" ? "turn_timeout" : "additional_read_failed";
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
      break;
    }
    const boundedResults = unseenResults.slice(0, remainingReadQueries);
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
