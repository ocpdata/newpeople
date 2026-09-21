import { describe, expect, it } from "vitest";
import { normalizeCoachResult } from "../src/routes.mi-agent.js";

describe("Coach operation normalization", () => {
  const snapshot = {
    pipeline: {
      opportunities: [{
        id: 10,
        account: { id: 1 },
        contact: { id: 2 },
        stageAnswers: [{ questionId: 7, code: "identificacion_motivacion_principal", prompt: "¿Cuál es el motivo de negocio principal?", answer: "La necesidad inicial" }],
        workspace: { actions: [{ id: 99 }] },
      }],
    },
    workboard: [],
    leads: [{ id: 30, accountId: 1 }],
    contactMappings: [{ id: 2, accountId: 1 }],
  };

  it("keeps a valid activity and its existing activity id", () => {
    const result = normalizeCoachResult({
      intent: "freeform",
      operations: [{
        kind: "activity",
        opportunityId: 10,
        activityId: 99,
        actionType: "meeting",
        title: "Reunión con Compras",
        scheduledAt: "2026-09-24T11:00",
      }],
    }, snapshot);

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].activityId).toBe(99);
  });

  it("drops an activity id that does not belong to the opportunity", () => {
    const result = normalizeCoachResult({
      operations: [{
        kind: "activity",
        opportunityId: 10,
        activityId: 777,
        title: "Actividad falsa",
      }],
    }, snapshot);

    expect(result.operations).toEqual([]);
  });

  it("keeps a proposed stage answer and its previous value", () => {
    const result = normalizeCoachResult({
      responseType: "change_request",
      operations: [{
        kind: "stage_answer",
        opportunityId: 10,
        questionId: 7,
        answerValue: "El cliente necesita evitar nuevos incidentes de seguridad.",
        title: "Registrar motivación del cliente",
      }],
    }, snapshot);

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].previousAnswer).toBe("La necesidad inicial");
    expect(result.operations[0].answerMode).toBe("replace");
  });

  it("infers a stage answer from a clear motivation update", () => {
    const result = normalizeCoachResult(
      { responseType: "change_request", operations: [] },
      snapshot,
      "actualiza la motivación del cliente es evitar cualquier problema de ciberseguridad",
      { opportunityId: 10 },
    );

    expect(result.responseType).toBe("change_request");
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].kind).toBe("stage_answer");
    expect(result.operations[0].questionId).toBe(7);
  });

  it("drops CRM operations that reference inaccessible entities", () => {
    const result = normalizeCoachResult({
      operations: [
        { kind: "account_field", accountId: 999, field: "name", value: "Otro" },
        { kind: "contact_field", contactId: 998, field: "email", value: "x@y.com" },
        { kind: "lead_call_outcome", interactionId: 997, substatusCode: "x", reasonCode: "y", requiredActionCode: "z" },
      ],
    }, snapshot);

    expect(result.operations).toEqual([]);
  });
});
