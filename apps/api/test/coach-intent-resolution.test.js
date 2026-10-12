import { describe, expect, it } from "vitest";
import { classifyB3 } from "../src/coach/classification/b3-preclassifier.js";
import { classifySemanticIntent } from "../src/coach/classification/semantic-intent-classifier.js";
import { resolveFinalIntent } from "../src/coach/classification/resolve-final-intent.js";
import { summarizeCoachDecisionTrace } from "../src/coach/decision-trace.js";

describe("Coach intent resolution architecture", () => {
  it("preclassifies strategic seller questions as coaching without turning them into operations", () => {
    const decision = classifyB3(
      "¿Qué oportunidades debería priorizar para mejorar mi performance en la cuenta más grande?",
      { accountId: 12 },
    );

    expect(decision.bucket).toBe("coaching");
    expect(decision.riskLevel).toBe("low");
    expect(decision.needsClarification).toBe(false);
  });

  it("preclassifies direct action requests as operation", () => {
    const decision = classifyB3("Actualiza el teléfono de esta cuenta", {
      accountId: 12,
    });

    expect(decision.bucket).toBe("operation");
    expect(decision.riskLevel).toBe("medium");
  });

  it("uses the semantic intent as the final decision when the signals are aligned", () => {
    const finalDecision = resolveFinalIntent(
      {
        bucket: "coaching",
        confidence: 0.9,
        signals: ["seller guidance"],
        needsClarification: false,
        riskLevel: "low",
      },
      {
        intent: "account_performance",
        confidence: 0.94,
        rationale: ["performance diagnostic"],
        evidence: ["seller asks for optimization"],
      },
      { canReadAccounts: true, canReadOpportunities: true },
      { accountId: 12 },
    );

    expect(finalDecision.intent).toBe("account_performance");
    expect(finalDecision.interactionMode).toBe("coaching");
    expect(finalDecision.policyProcess).toBe("seller_coaching");
    expect(finalDecision.requiresClarification).toBe(false);
  });

  it("does not let the preclassifier replace a valid semantic intent", () => {
    const finalDecision = resolveFinalIntent(
      { bucket: "coaching", confidence: 0.85 },
      { intent: "general_query", confidence: 0.82 },
      { canReadAccounts: true },
      {},
    );

    expect(finalDecision.intent).toBe("general_query");
  });

  it("blocks unauthorized operations even when semantic classification suggests creation", () => {
    const finalDecision = resolveFinalIntent(
      {
        bucket: "operation",
        confidence: 0.8,
        signals: ["action request"],
        needsClarification: false,
        riskLevel: "medium",
      },
      {
        intent: "create_opportunity",
        confidence: 0.89,
        rationale: ["seller wants to create an opportunity"],
        evidence: ["explicit create request"],
      },
      {
        canReadAccounts: true,
        canReadOpportunities: false,
        canWriteOpportunities: false,
      },
      { accountId: 12 },
    );

    expect(finalDecision.requiresClarification).toBe(true);
    expect(finalDecision.intent).toBe("clarify_needed");
    expect(finalDecision.reason).toBe("operation_not_allowed");
  });

  it("keeps the semantic classifier aware of business questions and coaching intents", async () => {
    const decision = await classifySemanticIntent(
      "¿Qué oportunidad tengo para mejorar el rendimiento en la cuenta más grande este año?",
      { accountId: 12 },
      async () => ({
        intent: "account_performance",
        confidence: 0.91,
        reason: "model classified performance coaching",
      }),
    );

    expect(decision.intent).toBe("account_performance");
    expect(decision.confidence).toBe(0.91);
  });

  it("requires model classification instead of falling back to heuristics", async () => {
    const decision = await classifySemanticIntent(
      "¿Qué oportunidades debería priorizar?",
    );

    expect(decision.intent).toBe("clarify_needed");
    expect(decision.rationale).toContain("model_classifier_unavailable");
  });

  it("summarizes preclassification, semantic intent, and the server disposition", () => {
    const summary = summarizeCoachDecisionTrace({
      preDecision: {
        bucket: "coaching",
        confidence: 0.9,
        signals: ["seller guidance"],
      },
      semanticDecision: {
        intent: "account_performance",
        confidence: 0.94,
        rationale: ["business outcome"],
      },
      finalDecision: {
        intent: "account_performance",
        interactionMode: "coaching",
        policyProcess: "seller_coaching",
        confidence: 0.92,
        requiresClarification: false,
        reason: "resolved",
        source: {
          preclassification: "coaching",
          semanticIntent: "account_performance",
          resolver: "final_decision",
        },
      },
      context: { accountId: 12 },
    });

    expect(summary.intent).toBe("account_performance");
    expect(summary.b3Bucket).toBe("coaching");
    expect(summary.semanticIntent).toBe("account_performance");
    expect(summary.resolution).toBe("final_decision");
    expect(summary.conflict).toBe("aligned");
    expect(summary.requiresClarification).toBe(false);
  });
});
