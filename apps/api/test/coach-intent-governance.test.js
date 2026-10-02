import { describe, expect, it } from "vitest";
import {
  buildCoachDetailHandoff,
  buildCoachIntentCatalogForPrompt,
  getMissingCoachIntentContext,
  isCoachEmailHelpQuestion,
  isCoachQuestionPhrasingHelp,
  isGeneralCoachProcessInformationQuestion,
  normalizeIntentExamples,
  validateCoachIntentClassification,
} from "../src/coach/intent-governance.js";

describe("Coach intent governance", () => {
  it("keeps the process-information intent independent of CRM context", () => {
    const catalog = buildCoachIntentCatalogForPrompt();
    const processIntent = catalog.find(
      (item) => item.intent === "process_information",
    );

    expect(processIntent).toMatchObject({
      requiredContext: [],
      allowedTools: [],
    });
    expect(processIntent.examples).toContain(
      "¿Qué etapas tiene el proceso de venta?",
    );
    expect(processIntent.examples).toContain("¿Cuál es el proceso de ventas?");
  });

  it("recognizes general process questions without capturing entity-specific requests", () => {
    expect(
      isGeneralCoachProcessInformationQuestion("¿Cuál es el proceso de ventas?"),
    ).toBe(true);
    expect(
      isGeneralCoachProcessInformationQuestion(
        "¿Qué etapas tiene el proceso de venta?",
      ),
    ).toBe(true);
    expect(
      isGeneralCoachProcessInformationQuestion(
        "¿Cuál es el proceso de ventas para esta oportunidad?",
      ),
    ).toBe(false);
  });

  it("recognizes email capability and draft questions but not unrelated email mentions", () => {
    expect(isCoachEmailHelpQuestion("¿Le puedo enviar un correo?")).toBe(true);
    expect(
      isCoachEmailHelpQuestion(
        "Pregunto por un ejemplo de un correo para esta oportunidad.",
      ),
    ).toBe(true);
    expect(isCoachEmailHelpQuestion("¿Qué correo envió el cliente?")).toBe(
      false,
    );
  });

  it("recognizes a request to rephrase an embedded customer question", () => {
    expect(
      isCoachQuestionPhrasingHelp(
        "¿Cómo puedo preguntar de otra manera: ¿Qué problema específico está tratando de resolver?",
      ),
    ).toBe(true);
    expect(
      isCoachQuestionPhrasingHelp(
        "¿Qué problema específico está tratando de resolver?",
      ),
    ).toBe(false);
  });

  it("gives seller coaching aggregate performance tools without requiring a selected record", () => {
    expect(
      validateCoachIntentClassification({
        intent: "seller_coaching",
        confidence: 0.94,
        mode: "coaching",
      }),
    ).toMatchObject({
      intent: "seller_coaching",
      mode: "coaching",
      requiredContext: [],
      allowedTools: [
        "getSellerPipeline",
        "searchOpportunities",
        "getOpportunity",
        "getOpportunityReadiness",
        "getOpportunityActivities",
        "searchAccounts",
        "searchLeads",
      ],
    });
  });

  it("serializes persisted catalog entries with server-owned tool metadata", () => {
    expect(
      buildCoachIntentCatalogForPrompt([
        {
          code: "custom_intent",
          description: "Custom test intent",
          examples: ["custom phrase"],
          requiredContext: ["account"],
          tools: ["searchAccounts"],
        },
      ]),
    ).toEqual([
      {
        intent: "custom_intent",
        description: "Custom test intent",
        examples: ["custom phrase"],
        requiredContext: ["account"],
        allowedTools: ["searchAccounts"],
      },
    ]);
  });

  it("accepts only catalog intents and server-owned context requirements", () => {
    const classification = validateCoachIntentClassification({
      intent: "quotation_query",
      confidence: 0.91,
      contextNeeded: ["opportunity", "untrusted_table"],
    });

    expect(classification).toMatchObject({
      intent: "quotation_query",
      requiredContext: ["opportunity"],
      suggestedContext: ["opportunity"],
      allowedTools: ["getOpportunityQuotation"],
      requiresClarification: false,
    });
    expect(getMissingCoachIntentContext(classification, {})).toEqual([
      "opportunity",
    ]);
    expect(
      getMissingCoachIntentContext(classification, { opportunityId: 42 }),
    ).toEqual([]);
  });

  it("separates brief context from detailed exploration and removes tools for details", () => {
    expect(
      validateCoachIntentClassification({
        intent: "quotation_query",
        confidence: 0.95,
        mode: "brief_context",
      }),
    ).toMatchObject({
      mode: "brief_context",
      requiredContext: ["opportunity"],
      allowedTools: ["getOpportunityQuotation"],
    });

    const deepClassification = validateCoachIntentClassification({
      intent: "quotation_query",
      confidence: 0.95,
      mode: "deep_exploration",
      detailTarget: "quotation",
    });
    expect(deepClassification).toMatchObject({
      mode: "deep_exploration",
      detailTarget: "quotation",
      requiredContext: ["opportunity"],
      allowedTools: [],
    });
  });

  it("creates only permission-gated handoffs from server-resolved entity IDs", () => {
    const classification = validateCoachIntentClassification({
      intent: "quotation_query",
      confidence: 0.96,
      mode: "deep_exploration",
      detailTarget: "quotation",
    });
    const handoff = buildCoachDetailHandoff({
      classification,
      context: { opportunityId: 41, accountId: 12 },
      canOpenCustomerWorkspace: true,
    });

    expect(handoff).toEqual({
      destination: "customer_account",
      detailTarget: "quotation",
      accountId: 12,
      opportunityId: 41,
      contactId: null,
      leadId: null,
    });
    expect(
      buildCoachDetailHandoff({
        classification,
        context: { opportunityId: 41, accountId: 12 },
        canOpenCustomerWorkspace: false,
      }),
    ).toBeNull();
  });

  it("sends inconsistent operation modes to clarification", () => {
    expect(
      validateCoachIntentClassification({
        intent: "account_query",
        confidence: 0.99,
        mode: "operation",
      }),
    ).toMatchObject({
      intent: "clarification",
      mode: "coaching",
      requiresClarification: true,
      allowedTools: [],
      reason: "intent_mode_mismatch",
    });
  });

  it("routes low confidence or invalid intent to clarification without tools", () => {
    expect(
      validateCoachIntentClassification({
        intent: "invented_intent",
        confidence: 0.99,
      }),
    ).toMatchObject({
      intent: "clarification",
      confidence: 0,
      requiresClarification: true,
      allowedTools: [],
    });
    expect(
      validateCoachIntentClassification({
        intent: "process_information",
        confidence: 0.2,
      }),
    ).toMatchObject({
      intent: "clarification",
      requiresClarification: true,
      allowedTools: [],
    });
  });

  it("normalizes bounded example lists without duplicates", () => {
    expect(
      normalizeIntentExamples([" Venta   proceso ", "Venta proceso"]),
    ).toEqual(["Venta proceso"]);
    expect(() => normalizeIntentExamples([])).toThrow(/entre 1 y 30/);
  });
});
