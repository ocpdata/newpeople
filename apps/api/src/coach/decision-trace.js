function normalizeDecisionFamily(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (
    ["coaching", "seller_coaching", "account_performance"].includes(normalized)
  ) {
    return "coaching";
  }
  if (
    [
      "brief_context",
      "account_query",
      "opportunity_query",
      "general_query",
    ].includes(normalized)
  ) {
    return "brief_context";
  }
  if (
    ["operation", "create_opportunity", "update_opportunity"].includes(
      normalized,
    )
  ) {
    return "operation";
  }
  if (normalized === "clarify_needed") {
    return "clarification";
  }
  return normalized || "unknown";
}

export function summarizeCoachDecisionTrace({
  preDecision = {},
  semanticDecision = {},
  finalDecision = {},
  context = {},
} = {}) {
  const b3Bucket = String(
    preDecision?.bucket || preDecision?.intent || "unknown",
  ).trim();
  const semanticIntent = String(
    semanticDecision?.intent || semanticDecision?.bucket || "unknown",
  ).trim();
  const finalIntent = String(
    finalDecision?.intent ||
      finalDecision?.finalIntent ||
      semanticDecision?.intent ||
      "unknown",
  ).trim();
  const resolution =
    finalDecision?.source?.resolver ||
    finalDecision?.resolver ||
    (finalDecision?.reason === "operation_not_allowed"
      ? "permission_gate"
      : "unknown");
  const hasConflict = ![
    normalizeDecisionFamily(b3Bucket) ===
      normalizeDecisionFamily(semanticIntent),
    normalizeDecisionFamily(b3Bucket) === normalizeDecisionFamily(finalIntent),
    normalizeDecisionFamily(semanticIntent) ===
      normalizeDecisionFamily(finalIntent),
  ].some(Boolean);

  return {
    intent: finalIntent,
    b3Bucket,
    semanticIntent,
    resolution,
    conflict: hasConflict ? "conflict" : "aligned",
    requiresClarification: Boolean(finalDecision?.requiresClarification),
    confidence: Number(
      finalDecision?.confidence ??
        semanticDecision?.confidence ??
        preDecision?.confidence ??
        0,
    ),
    interactionMode: finalDecision?.interactionMode || null,
    policyProcess: finalDecision?.policyProcess || null,
    reason: finalDecision?.reason || null,
    context: Object.keys(context || {}).reduce((snapshot, key) => {
      const value = context[key];
      if (value !== undefined && value !== null) {
        snapshot[key] = value;
      }
      return snapshot;
    }, {}),
  };
}
