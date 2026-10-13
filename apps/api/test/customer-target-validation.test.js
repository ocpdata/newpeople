import { describe, expect, it, vi } from "vitest";
import {
  validateCustomerPlanTarget,
  customerTargetClarification,
} from "../src/commercial-intelligence/customer-target-validation.js";
import { normalizeChannelIntentPlan } from "../src/coach/channel-intents.js";
import { buildStructuredResearchSchema } from "../src/structuredWebResearch.js";

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
const verdict = (status, references = []) => ({
  status, references: references.map((reference) => ({ kind: "entity", ...reference })),
  reason: "test_verdict",
});

describe("Independent customer target validation", () => {
  it.each([
    ["que oportunidades hay abiertas?", "opportunity", "opportunity_query", { opportunityStatus: "open" }],
    ["¿Cuánto suman las oportunidades abiertas?", "opportunity", "opportunity_query", { opportunityStatus: "open" }],
    ["¿Cuántos contactos hay?", "contact", "contact_query", {}],
    ["Lista los leads", "lead", "lead_query", {}],
  ])("accepts a collection without requiring an individual reference: %s", async (question, entityType, query, filters) => {
    const validateWithAI = vi.fn().mockResolvedValue(verdict("aligned", [
      { text: question, kind: "collection", entityType, candidateKeys: [] },
    ]));
    const result = await validateCustomerPlanTarget({
      ...base, question,
      plan: { ...oldPlan, queries: [query], entities: { accountReference: "Totalplay" }, filters,
        referenceResolution: { targetType: "account", cardinality: "single", source: "active_context", candidateKeys: [] } },
      validateWithAI,
    });
    expect(result.status).toBe("aligned");
    const request = validateWithAI.mock.calls[0][0];
    expect(request.context.proposedPlan.filters).toEqual(filters);
    expect(request.systemPrompt).toContain("No conviertas una pregunta completa");
    expect(request.fields.find((field) => field.key === "references").items.fields)
      .toContainEqual(expect.objectContaining({ key: "kind", enum: ["entity", "collection"] }));
    const referenceSchema = buildStructuredResearchSchema(request.schemaName, request.fields)
      .schema.properties.references.items;
    expect(referenceSchema.required).toContain("kind");
    expect(referenceSchema.properties.kind.enum).toEqual(["entity", "collection"]);
  });

  it("allows an explicitly named selected account while querying its opportunity collection", async () => {
    const result = await validateCustomerPlanTarget({
      ...base, question: "Lista oportunidades abiertas de Totalplay",
      plan: { ...oldPlan, entities: { accountReference: "Totalplay" }, filters: { opportunityStatus: "open" },
        referenceResolution: { targetType: "account", cardinality: "single", source: "message", candidateKeys: [] } },
      validateWithAI: async () => verdict("aligned", [
        { text: "oportunidades", kind: "collection", entityType: "opportunity", candidateKeys: [] },
        { text: "Totalplay", kind: "entity", entityType: "account", candidateKeys: [] },
      ]),
    });
    expect(result.status).toBe("aligned");
  });

  it.each([
    oldPlan,
    { ...oldPlan, entities: { accountReference: "Totalplay" } },
    { ...oldPlan, referenceResolution: { ...oldPlan.referenceResolution, candidateKeys: [] } },
  ])("does not let collection classification approve an old individual target", async (plan) => {
    const result = await validateCustomerPlanTarget({
      ...base, question: "que oportunidades hay abiertas?", plan,
      validateWithAI: async () => verdict("aligned", [
        { text: "oportunidades", kind: "collection", entityType: "opportunity", candidateKeys: [] },
      ]),
    });
    expect(result).toMatchObject({ status: "mismatch", reason: "collection_target_narrowed" });
    expect(customerTargetClarification(result)).not.toContain('"oportunidades"');
  });

  it("keeps explicit account correspondence mandatory in a collection request", async () => {
    const result = await validateCustomerPlanTarget({
      ...base, question: "Lista oportunidades de Grupo Nébula",
      plan: { ...oldPlan, entities: { accountReference: "Totalplay" },
        referenceResolution: { targetType: "account", cardinality: "single", source: "active_context", candidateKeys: [] } },
      validateWithAI: async () => verdict("aligned", [
        { text: "oportunidades", kind: "collection", entityType: "opportunity", candidateKeys: [] },
        { text: "Grupo Nébula", kind: "entity", entityType: "account", candidateKeys: [] },
      ]),
    });
    expect(result.status).toBe("mismatch");
    expect(customerTargetClarification(result)).toContain("Grupo Nébula");
  });

  it("rejects collection references with individual candidate keys", async () => {
    await expect(validateCustomerPlanTarget({
      ...base, question: "Lista oportunidades", plan: oldPlan,
      validateWithAI: async () => verdict("aligned", [
        { text: "oportunidades", kind: "collection", entityType: "opportunity", candidateKeys: ["opportunity_1"] },
      ]),
    })).rejects.toMatchObject({
      code: "target_collection_candidates_invalid",
      targetValidationDetails: { references: [
        { text: "oportunidades", kind: "collection", entityType: "opportunity", candidateKeys: ["opportunity_1"] },
      ] },
    });
  });

  it("rejects the old untyped extraction rather than assuming it identifies an entity", async () => {
    await expect(validateCustomerPlanTarget({
      ...base, question: "que oportunidades hay abiertas?", plan: oldPlan,
      validateWithAI: async () => ({
        status: "aligned", reason: "",
        references: [{ text: "que oportunidades hay abiertas?", entityType: "opportunity", candidateKeys: [] }],
      }),
    })).rejects.toThrow();
  });

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
    })).rejects.toMatchObject({
      code: "target_verdict_invalid",
      targetValidationDetails: { issues: expect.arrayContaining([
        expect.objectContaining({ path: "references" }),
      ]) },
    });
  });
});
