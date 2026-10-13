import { describe, expect, it, vi } from "vitest";
import {
  validateCustomerPlanTarget,
  customerTargetClarification,
} from "../src/commercial-intelligence/customer-target-validation.js";
import { normalizeChannelIntentPlan } from "../src/coach/channel-intents.js";

const candidates = [
  { candidateKey: "opportunity_1", entityType: "opportunity", name: "Vrf 2027" },
  { candidateKey: "opportunity_2", entityType: "opportunity", name: "DNS 2027" },
];
const oldPlan = {
  queries: ["opportunity_query"], mode: "read_only", confidence: "high",
  entities: { accountReference: "Totalplay", opportunityReference: "Vrf 2027" },
  referenceResolution: {
    targetType: "opportunity", cardinality: "single",
    source: "conversation_history", candidateKeys: ["opportunity_1"],
  },
};
const base = {
  selectedAccount: { name: "Totalplay" }, candidates,
  conversationHistory: [{ role: "assistant", text: "Vrf 2027 tiene un monto de 2,000,000 USD." }],
};
const verdict = (status, references = []) => ({ status, references, reason: "test_verdict" });

describe("Independent customer target validation", () => {
  it.each(["other_account", "ambiguous", "mismatch"])(
    "detects the original Grupo Nébula reference even when B6 replaces it (%s)", async (status) => {
      const question = "Busca la oportunidad de Grupo Nébula y dime su monto.";
      const validateWithAI = vi.fn().mockResolvedValue(verdict(status, [
        { text: "Grupo Nébula", entityType: "account", candidateKeys: [] },
      ]));
      const result = await validateCustomerPlanTarget({ ...base, question, plan: oldPlan, validateWithAI });
      expect(validateWithAI.mock.calls[0][0].context).toMatchObject({
        question,
        proposedPlan: { entities: { accountReference: "Totalplay" } },
      });
      expect(result.status).toBe(status);
      const routing = normalizeChannelIntentPlan({
        channel: "customer_account",
        plan: { ...oldPlan, serverTargetValidation: {
          ...result, clarificationQuestion: customerTargetClarification(result),
        } },
        authoritativeIntent: { intent: "opportunity_query", confidence: 0.95 },
        context: { accountId: 7 },
      });
      expect(routing).toMatchObject({
        mode: "clarification", requiresClarification: true,
        allowedTools: [], intents: [], operationKind: "none",
        validationDiagnostics: { targetCorrespondence: status },
      });
    },
  );

  it("rejects an authorized but different candidate even if the semantic verdict says aligned", async () => {
    const result = await validateCustomerPlanTarget({
      ...base, question: "Dime el monto de DNS 2027", plan: oldPlan,
      validateWithAI: async () => verdict("aligned", [
        { text: "DNS 2027", entityType: "opportunity", candidateKeys: ["opportunity_2"] },
      ]),
    });
    expect(result.status).toBe("mismatch");
  });

  it("accepts an explicit new opportunity and its verified candidate, not the old focus", async () => {
    const result = await validateCustomerPlanTarget({
      ...base, question: "Dime el monto de DNS 2027",
      plan: { ...oldPlan, entities: { opportunityReference: "DNS 2027" },
        referenceResolution: { ...oldPlan.referenceResolution, source: "message", candidateKeys: ["opportunity_2"] } },
      validateWithAI: async () => verdict("aligned", [
        { text: "DNS 2027", entityType: "opportunity", candidateKeys: ["opportunity_2"] },
      ]),
    });
    expect(result.status).toBe("aligned");
  });

  it("allows authorized alias resolution without requiring literal candidate names", async () => {
    const result = await validateCustomerPlanTarget({
      ...base, question: "Dime el monto del proyecto VRF",
      plan: oldPlan,
      validateWithAI: async () => verdict("aligned", [
        { text: "proyecto VRF", entityType: "opportunity", candidateKeys: ["opportunity_1"] },
      ]),
    });
    expect(result.status).toBe("aligned");
  });

  it("allows an unresolved explicit reference only when preserved for search without an old candidate", async () => {
    const result = await validateCustomerPlanTarget({
      ...base, question: "Busca Proyecto Alfa",
      plan: { ...oldPlan, entities: { opportunityReference: "Proyecto Alfa" },
        referenceResolution: { targetType: "opportunity", source: "message", cardinality: "none", candidateKeys: [] } },
      validateWithAI: async () => verdict("aligned", [
        { text: "Proyecto Alfa", entityType: "opportunity", candidateKeys: [] },
      ]),
    });
    expect(result.status).toBe("aligned");
  });

  it("preserves unambiguous factual follow-ups without inventing explicit references", async () => {
    const result = await validateCustomerPlanTarget({
      ...base, question: "¿Y en qué etapa está?", plan: oldPlan,
      validateWithAI: async () => verdict("aligned"),
    });
    expect(result.status).toBe("aligned");
  });

  it.each([
    [{ text: "DNS 2027", entityType: "opportunity", candidateKeys: ["invented"] }],
    [{ text: "Vrf 2027", entityType: "opportunity", candidateKeys: ["opportunity_1"] }],
    [{ text: "DNS 2027", entityType: "contact", candidateKeys: ["opportunity_2"] }],
  ])("rejects fabricated quote, candidate or entity type", async (reference) => {
    await expect(validateCustomerPlanTarget({
      ...base, question: "Dime el monto de DNS 2027", plan: oldPlan,
      validateWithAI: async () => verdict("aligned", [reference]),
    })).rejects.toThrow("referencias no verificables");
  });

  it("propagates unavailable validation instead of approving the plan", async () => {
    await expect(validateCustomerPlanTarget({
      ...base, question: "Dime su monto", plan: oldPlan,
      validateWithAI: async () => { throw new Error("Provider unavailable"); },
    })).rejects.toThrow("Provider unavailable");
  });

  it("rejects missing or malformed verdicts", async () => {
    await expect(validateCustomerPlanTarget({
      ...base, question: "Dime su monto", plan: oldPlan,
      validateWithAI: async () => ({ status: "aligned" }),
    })).rejects.toThrow();
  });
});
