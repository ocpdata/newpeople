import { describe, expect, it } from "vitest";
import { normalizeCoachResult } from "../src/routes.mi-agent.js";

describe("Coach operation normalization", () => {
  const authoritativeStageReadiness = {
    currentStage: {
      id: 3,
      code: "desarrollo",
      name: "Desarrollo",
      objective: "Validar la solución propuesta.",
    },
    confirmedProgress: [],
    pendingItems: [
      {
        title: "Ajuste técnico",
        detail: "Falta evidencia verificable.",
        evidence: [],
      },
    ],
    risks: [],
    nextStep: {
      action: "Validar el ajuste técnico",
      responsibleUserId: 7,
      targetDate: "2026-10-03",
      successCriteria: "Registrar la aceptación técnica.",
    },
    recommendation: "remain",
    rationale: "Falta un criterio requerido.",
  };
  const snapshot = {
    pipeline: {
      opportunities: [
        {
          id: 10,
          name: "Oportunidad de prueba",
          amountUsd: 90000,
          account: { id: 1 },
          contact: { id: 2 },
          stageAnswers: [
            {
              questionId: 7,
              code: "identificacion_motivacion_principal",
              prompt: "¿Cuál es el motivo de negocio principal?",
              answer: "La necesidad inicial",
            },
          ],
          workspace: { actions: [{ id: 99 }] },
        },
      ],
    },
    workboard: [],
    leads: [{ id: 30, accountId: 1 }],
    contactMappings: [{ id: 2, accountId: 1 }],
  };

  it("keeps a valid activity and its existing activity id", () => {
    const result = normalizeCoachResult(
      {
        intent: "freeform",
        operations: [
          {
            kind: "activity",
            opportunityId: 10,
            activityId: 99,
            actionType: "meeting",
            title: "Reunión con Compras",
            scheduledAt: "2026-09-24T11:00",
          },
        ],
      },
      snapshot,
    );

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].activityId).toBe(99);
  });

  it("inherits the selected opportunity for a new activity", () => {
    const result = normalizeCoachResult(
      {
        operations: [
          {
            kind: "activity",
            actionType: "call",
            title: "Llamar al cliente",
          },
        ],
      },
      snapshot,
      "Crea una llamada",
      { opportunityId: 10 },
    );

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].opportunityId).toBe(10);
  });

  it("proposes an activity on the selected opportunity when the model returns none", () => {
    const result = normalizeCoachResult(
      { operations: [] },
      snapshot,
      "Crea una demostración para esta oportunidad",
      { opportunityId: 10 },
    );

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({
      kind: "activity",
      opportunityId: 10,
      actionType: "presentation",
    });
  });

  it("drops an activity id that does not belong to the opportunity", () => {
    const result = normalizeCoachResult(
      {
        operations: [
          {
            kind: "activity",
            opportunityId: 10,
            activityId: 777,
            title: "Actividad falsa",
          },
        ],
      },
      snapshot,
    );

    expect(result.operations).toEqual([]);
  });

  it("keeps a proposed stage answer and its previous value", () => {
    const result = normalizeCoachResult(
      {
        responseType: "change_request",
        operations: [
          {
            kind: "stage_answer",
            opportunityId: 10,
            questionId: 7,
            answerValue:
              "El cliente necesita evitar nuevos incidentes de seguridad.",
            title: "Registrar motivación del cliente",
          },
        ],
      },
      snapshot,
    );

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

    expect(result.responseType).toBe("action_proposal");
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].kind).toBe("stage_answer");
    expect(result.operations[0].questionId).toBe(7);
  });

  it("answers the selected opportunity amount from CRM data", () => {
    const result = normalizeCoachResult(
      { answer: "El total del pipeline es 999999 USD." },
      snapshot,
      "¿Cuál es el importe de esta oportunidad?",
      { opportunityId: 10 },
    );

    expect(result.answer).toBe(
      "El importe de la oportunidad 10 es 90,000.00 USD.",
    );
    expect(result.entities.opportunityId).toBe(10);
  });

  it("creates an amount update for the selected opportunity when the model omits it", () => {
    const result = normalizeCoachResult(
      { responseType: "change_request", operations: [] },
      snapshot,
      "Cambia el monto a 100,000 dólares",
      { opportunityId: 10 },
    );

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({
      kind: "opportunity_field",
      opportunityId: 10,
      field: "amountUsd",
      value: "100000",
    });
  });

  it("replaces a contradictory missing-opportunity answer when an operation is scoped", () => {
    const result = normalizeCoachResult(
      {
        responseType: "change_request",
        answer:
          "Para cambiar el monto necesito confirmar la oportunidad específica a modificar, ya que no hay una oportunidad seleccionada actualmente.",
        operations: [
          {
            kind: "opportunity_field",
            field: "amountUsd",
            value: "100000",
          },
        ],
      },
      snapshot,
      "Cambia el monto a 100,000 dólares",
      { opportunityId: 10 },
    );

    expect(result.answer).toBe(
      "Se propone cambiar el importe de la oportunidad 10 a 100,000.00 USD.",
    );
    expect(result.entities.opportunityId).toBe(10);
  });

  it("drops CRM operations that reference inaccessible entities", () => {
    const result = normalizeCoachResult(
      {
        operations: [
          {
            kind: "account_field",
            accountId: 999,
            field: "name",
            value: "Otro",
          },
          {
            kind: "contact_field",
            contactId: 998,
            field: "email",
            value: "x@y.com",
          },
          {
            kind: "lead_call_outcome",
            interactionId: 997,
            substatusCode: "x",
            reasonCode: "y",
            requiredActionCode: "z",
          },
        ],
      },
      snapshot,
    );

    expect(result.operations).toEqual([]);
  });

  it("falls back without operations when the normalized response violates the contract", () => {
    const result = normalizeCoachResult(
      {
        answer: "Actualizaré el importe.",
        facts: [{ sourceType: "invented_source", sourceId: 10, label: "Dato" }],
        operations: [
          {
            kind: "opportunity_field",
            opportunityId: 10,
            field: "amountUsd",
            value: 100000,
            title: "Actualizar importe",
          },
        ],
      },
      snapshot,
      "Cambia el monto",
      { opportunityId: 10 },
    );

    expect(result.responseType).toBe("error");
    expect(result.confidence).toBe("low");
    expect(result.operations).toEqual([]);
  });

  it("keeps a coaching recommendation when optional model fields are incomplete", () => {
    const result = normalizeCoachResult(
      {
        intent: "recommendation",
        responseType: "recommendation",
        answer: "Prioriza la oportunidad y confirma la fecha de decisión.",
        facts: [
          {
            sourceType: "opportunity",
            sourceId: 0,
            label: "Oportunidad abierta",
            excerpt: "La oportunidad sigue activa.",
          },
        ],
        evidence: ["La oportunidad sigue activa."],
        inferences: [],
        pendingItems: [],
        recommendation: {
          action: "Confirmar la fecha de decisión.",
          rationale: "La fecha aún no está definida.",
        },
        confidence: "medium",
        entities: {
          opportunityId: 10,
          accountId: 1,
          contactId: 2,
          leadId: null,
          names: [],
        },
        operations: [],
        clarification: null,
        action: {},
        intentRouting: { intent: "seller_coaching" },
        stageReadiness: {},
      },
      snapshot,
      "¿Qué me sugieres hacer?",
      { opportunityId: 10 },
    );

    expect(result.responseType).toBe("recommendation");
    expect(result.confidence).toBe("medium");
    expect(result.answer).toBe(
      "Prioriza la oportunidad y confirma la fecha de decisión.",
    );
    expect(result.facts[0].sourceId).toBeNull();
    expect(result.recommendation).toContain("Confirmar la fecha de decisión.");
    expect(result.action).toBeNull();
    expect(result.stageReadiness).toBeNull();
  });

  it("does not let the model override authoritative stage readiness", () => {
    const result = normalizeCoachResult(
      {
        intent: "opportunity_preparation",
        answer: "Puedes avanzar.",
        stageReadiness: {
          ...authoritativeStageReadiness,
          pendingItems: [],
          recommendation: "advance",
          rationale: "Todo está completo.",
        },
      },
      snapshot,
      "¿Qué me falta para avanzar de etapa?",
      { opportunityId: 10 },
      authoritativeStageReadiness,
    );

    expect(result.intent).toBe("opportunity_preparation");
    expect(result.stageReadiness).toEqual(authoritativeStageReadiness);
    expect(result.stageReadiness.recommendation).toBe("remain");
  });

  it("preserves all readiness blocks when the model response is invalid", () => {
    const result = normalizeCoachResult(
      {
        answer: "Diagnóstico disponible.",
        facts: [{ sourceType: "invented_source", label: "Dato inválido" }],
      },
      snapshot,
      "¿Estoy listo para pasar a cotización?",
      { opportunityId: 10 },
      authoritativeStageReadiness,
    );

    expect(result.confidence).toBe("low");
    expect(result.stageReadiness).toEqual(authoritativeStageReadiness);
    expect(Object.keys(result.stageReadiness)).toEqual([
      "currentStage",
      "confirmedProgress",
      "pendingItems",
      "risks",
      "nextStep",
      "recommendation",
      "rationale",
    ]);
  });

  it("preserves a general entity clarification and its original request", () => {
    const result = normalizeCoachResult(
      {
        intent: "clarification",
        responseType: "clarification",
        answer: "Encontré varias cuentas Acme.",
        confidence: "high",
        clarification: {
          type: "select_account",
          message: "Selecciona una cuenta para continuar.",
          missing: ["Cuenta"],
          candidates: [
            {
              id: 1,
              name: "Acme México",
              entityType: "account",
              website: "acme.mx",
            },
            {
              id: 2,
              name: "Acme Servicios",
              entityType: "account",
              website: "servicios.acme.mx",
            },
          ],
          originalRequest: "Actualiza el teléfono de Acme",
          intendedAction: "continue_request",
        },
        operations: [],
      },
      snapshot,
    );

    expect(result.intent).toBe("clarification");
    expect(result.responseType).toBe("clarification");
    expect(result.clarification).toEqual(
      expect.objectContaining({
        type: "select_account",
        originalRequest: "Actualiza el teléfono de Acme",
      }),
    );
    expect(result.operations).toEqual([]);
  });
});
