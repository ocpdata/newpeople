import { describe, expect, it } from "vitest";
import { coachOperationSchema } from "../src/coach/contract.js";
import {
  normalizeActivityOperation,
  normalizeProspectConversionOperation,
} from "../src/coach/operation-contract.js";

describe("Common operation contract", () => {
  it("normalizes a customer account activity to the Coach schema", () => {
    const operation = normalizeActivityOperation(
      { title: "Contactar al cliente", actionType: "call" },
      { opportunityId: 11 },
    );

    expect(coachOperationSchema.safeParse(operation).success).toBe(true);
    expect(operation.requiresConfirmation).toBe(true);
    expect(operation.sourceChannel).toBe("customer_account");
  });

  it("normalizes a prospect conversion to a confirmed handoff", () => {
    const operation = normalizeProspectConversionOperation(
      { title: "Crear cuenta prospecto", notes: "Revisar duplicados" },
      { prospectSessionId: 10, target: "account" },
    );

    expect(coachOperationSchema.safeParse(operation).success).toBe(true);
    expect(operation.kind).toBe("create_account");
    expect(operation.requiresConfirmation).toBe(true);
    expect(operation.sourceChannel).toBe("prospect");
    expect(operation.payload.prospectSessionId).toBe(10);
  });
});
