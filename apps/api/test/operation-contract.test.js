import { describe, expect, it } from "vitest";
import { coachOperationSchema } from "../src/coach/contract.js";
import {
  COMMERCIAL_ACTIVITY_TYPES,
  getCommercialActivityTypeLabel,
  normalizeCommercialActivityType,
} from "../../../shared/commercial-activity-types.js";
import {
  normalizeActivityOperation,
  normalizeProspectConversionOperation,
} from "../src/coach/operation-contract.js";

describe("Common operation contract", () => {
  it.each(COMMERCIAL_ACTIVITY_TYPES)(
    "accepts canonical activity $value",
    ({ value }) => {
      const operation = normalizeActivityOperation(
        {
          title: "Actividad",
          actionType: value,
          scheduledAt: "2026-12-15T10:30",
          notes: "Contexto",
          successCriteria: "Resultado",
        },
        { accountId: 3, contactId: 4 },
      );
      expect(coachOperationSchema.safeParse(operation).success).toBe(true);
      expect(operation).toMatchObject({
        actionType: value,
        calendarKind: "standalone",
        accountId: 3,
        contactId: 4,
        scheduledAt: "2026-12-15T10:30",
        notes: "Contexto",
        successCriteria: "Resultado",
      });
    },
  );

  it.each([
    ["lead", { interactionId: 5 }, { type: "lead", id: 5 }],
    ["opportunity", { opportunityId: 6 }, { type: "opportunity", id: 6 }],
    ["standalone", { accountId: 7 }, { type: "account", id: 7 }],
  ])("preserves %s source and relations", (calendarKind, relations, source) => {
    const operation = normalizeActivityOperation({
      title: "Actividad",
      ...relations,
    });
    expect(operation).toMatchObject({ calendarKind, ...relations, source });
    expect(coachOperationSchema.safeParse(operation).success).toBe(true);
  });

  it("keeps historical meeting display unspecified and rejects unknown API types", () => {
    expect(getCommercialActivityTypeLabel("conference")).toBe(
      "Reunión (tipo no especificado)",
    );
    expect(normalizeCommercialActivityType("demo")).toBe("demo");
    expect(normalizeCommercialActivityType("presentation")).toBe(
      "presentation",
    );
    expect(normalizeCommercialActivityType("invalid", "")).toBe("");
  });
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
