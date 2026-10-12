export function detectConflict(preDecision, semanticDecision) {
  if (!preDecision || !semanticDecision) {
    return { isStrongConflict: false, reason: null };
  }

  const preBucket = preDecision.bucket || "unknown";
  const semanticIntent = semanticDecision.intent || "general_query";

  const operationIntent = [
    "create_opportunity",
    "update_opportunity",
    "create_contact",
  ].includes(semanticIntent);
  const coachingBucket = preBucket === "coaching";

  if (operationIntent && coachingBucket) {
    return {
      isStrongConflict: true,
      reason: "operation_vs_coaching",
    };
  }

  return { isStrongConflict: false, reason: null };
}

export function chooseBestIntent(preDecision, semanticDecision, context = {}) {
  const semanticIntent = semanticDecision?.intent;
  const preBucket = preDecision?.bucket || "unknown";

  if (context?.forceIntent) return context.forceIntent;

  if (semanticIntent) {
    return semanticIntent;
  }

  if (preBucket === "operation") return "create_opportunity";
  if (preBucket === "coaching") return "seller_coaching";
  if (preBucket === "deep_exploration") return "account_performance";
  if (preBucket === "brief_context") return "account_query";

  return "clarify_needed";
}
