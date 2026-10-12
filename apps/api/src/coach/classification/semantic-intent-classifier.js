const COACH_INTENTS = new Set([
  "seller_coaching",
  "account_performance",
  "account_query",
  "opportunity_query",
  "create_opportunity",
  "update_opportunity",
  "general_query",
  "clarify_needed",
]);

function clarificationDecision(reason) {
  return {
    intent: "clarify_needed",
    confidence: 0,
    rationale: [reason],
    evidence: [],
  };
}

export async function classifySemanticIntent(
  message = "",
  context = {},
  classifyWithModel,
) {
  if (!String(message || "").trim()) {
    return clarificationDecision("empty_message");
  }
  if (typeof classifyWithModel !== "function") {
    return clarificationDecision("model_classifier_unavailable");
  }

  let result;
  try {
    result = await classifyWithModel({ message, context });
  } catch {
    return clarificationDecision("model_classifier_failed");
  }

  const intent = String(result?.intent || "").trim();
  const confidence = Number(result?.confidence);
  if (
    !COACH_INTENTS.has(intent) ||
    !Number.isFinite(confidence) ||
    confidence < 0.68 ||
    confidence > 1
  ) {
    return clarificationDecision(
      "invalid_or_low_confidence_model_classification",
    );
  }

  return {
    intent,
    confidence,
    rationale: [String(result.reason || "model_classification").slice(0, 300)],
    evidence: ["model_semantic_classification"],
  };
}