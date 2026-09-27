import { describe, expect, it } from "vitest";

import {
  coachOperationResultSchema,
  coachOperationSchema,
  coachResponseSchema,
  stageReadinessSchema,
} from "../src/coach/contract.js";

const operationCommon = {
  title: "Actualizar monto",
  evidence: [],
  missingFields: [],
  requiresConfirmation: true,
};

const delegatedOperations = [
  ["create_account", "accounts", "account"],
  ["create_contact", "contacts", "contact"],
  ["create_opportunity", "opportunities", "opportunity"],
  ["create_lead", "interactions", "lead"],
  ["create_contact_mapping", "contact_mapping", "contact_mapping"],
  ["create_quotation", "quotations", "quotation"],
  ["create_proposal", "proposals", "proposal"],
  ["lead_resolve", "interactions", "lead"],
];

function validResponse(overrides = {}) {
  return {
    intent: "context_query",
    responseType: "informational",
    answer: "El monto registrado es USD 10,000.",
    facts: [],
    evidence: ["Monto registrado en CRM"],
    inferences: [],
    pendingItems: [],
    recommendation: null,
    confidence: "high",
    entities: {
      opportunityId: 4,
      accountId: 2,
      contactId: null,
      leadId: null,
      names: ["Renovacion anual"],
    },
    operations: [],
    clarification: null,
    action: null,
    stageReadiness: null,
    ...overrides,
  };
}

describe("Coach strict contracts", () => {
  it("rejects unknown response fields", () => {
    const parsed = coachResponseSchema.safeParse({
      ...validResponse(),
      unexpected: true,
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts a valid operation variant", () => {
    const parsed = coachOperationSchema.safeParse({
      kind: "opportunity_field",
      ...operationCommon,
      opportunityId: 4,
      field: "amountUsd",
      currentValue: 9000,
      value: 10000,
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects fields from another operation variant", () => {
    const parsed = coachOperationSchema.safeParse({
      kind: "opportunity_field",
      ...operationCommon,
      opportunityId: 4,
      contactId: 8,
      field: "amountUsd",
      value: 10000,
    });

    expect(parsed.success).toBe(false);
  });

  it("limits a response to six operations", () => {
    const operation = {
      kind: "opportunity_field",
      ...operationCommon,
      opportunityId: 4,
      field: "amountUsd",
      value: 10000,
    };
    const parsed = coachResponseSchema.safeParse(
      validResponse({
        operations: Array.from({ length: 7 }, () => operation),
      }),
    );

    expect(parsed.success).toBe(false);
  });

  it("requires stage readiness for opportunity preparation", () => {
    const parsed = coachResponseSchema.safeParse(
      validResponse({
        intent: "opportunity_preparation",
      }),
    );

    expect(parsed.success).toBe(false);
  });

  it("requires all stage readiness blocks and valid dates", () => {
    const parsed = stageReadinessSchema.safeParse({
      currentStage: {
        id: 3,
        code: "negociacion",
        name: "Negociacion",
        objective: "Acordar terminos de cierre.",
      },
      confirmedProgress: [],
      pendingItems: [],
      risks: [],
      nextStep: {
        action: "Confirmar fecha de firma.",
        responsibleUserId: 7,
        targetDate: "2026-02-30",
        successCriteria: "Fecha confirmada por el cliente.",
      },
      recommendation: "remain",
      rationale: "Falta confirmar la fecha.",
    });

    expect(parsed.success).toBe(false);
  });

  it("enforces the target module for creation handoffs", () => {
    const parsed = coachOperationSchema.safeParse({
      kind: "create_contact",
      ...operationCommon,
      targetModule: "opportunities",
      payload: { firstName: "Ana" },
    });

    expect(parsed.success).toBe(false);
  });

  it.each(delegatedOperations)(
    "accepts %s only with its canonical module and entity type",
    (kind, targetModule, entityType) => {
      const operation = {
        kind,
        ...operationCommon,
        targetModule,
        entityType,
        payload: {},
      };

      expect(coachOperationSchema.safeParse(operation).success).toBe(true);
      expect(
        coachOperationSchema.safeParse({
          ...operation,
          targetModule: "wrong_module",
        }).success,
      ).toBe(false);
      expect(
        coachOperationSchema.safeParse({
          ...operation,
          accountField: "city",
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    ["account_field", "accountId"],
    ["contact_field", "contactId"],
    ["opportunity_field", "opportunityId"],
    ["stage_answer", "opportunityId"],
    ["lead_call_outcome", "interactionId"],
  ])("rejects invented identifiers for %s", (kind, idField) => {
    const validByKind = {
      account_field: { field: "city", value: "Puebla" },
      contact_field: { field: "city", value: "Puebla" },
      opportunity_field: { field: "amountUsd", value: 12000 },
      stage_answer: {
        questionId: 4,
        answerValue: "Confirmado",
        answerMode: "replace",
      },
      lead_call_outcome: {
        substatusCode: "contacted",
        reasonCode: "qualified",
        requiredActionCode: "follow_up",
      },
    };
    const parsed = coachOperationSchema.safeParse({
      kind,
      ...operationCommon,
      ...validByKind[kind],
      [idField]: 0,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects invalid operation result identifiers", () => {
    const parsed = coachOperationResultSchema.safeParse({
      operationId: 0,
      status: "failed",
      targetModule: "contacts",
      entityId: null,
      message: "No se pudo abrir el formulario.",
      errorCode: "INVALID_CONTEXT",
    });

    expect(parsed.success).toBe(false);
  });
});
