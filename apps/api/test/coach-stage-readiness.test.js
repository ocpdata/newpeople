import { describe, expect, it } from "vitest";

import {
  buildStageReadiness,
  isStagePreparationQuestion,
} from "../src/coach/stage-readiness.js";

function opportunity(overrides = {}) {
  return {
    id: 10,
    salesStageId: 3,
    stageCode: "desarrollo",
    stageName: "Desarrollo",
    currentStage: {
      code: "desarrollo",
      name: "Desarrollo",
      objective: "Validar la solución propuesta.",
      expectedOutcome: "Propuesta técnica validada.",
      criteria: [
        {
          code: "technical_fit",
          title: "Ajuste técnico",
          description: "La solución cubre los requerimientos.",
          required: true,
        },
      ],
    },
    stageQuestions: [
      {
        questionId: 21,
        code: "technical_need",
        prompt: "¿La solución cubre el requerimiento?",
        required: true,
        answer: "Sí, fue validada con el equipo técnico.",
      },
    ],
    riskReasons: [],
    workspace: {
      criteria: [
        {
          code: "technical_fit",
          status: "solid",
          summary: "Validación técnica completada.",
          evidenceCount: 1,
        },
      ],
      actions: [
        {
          id: 31,
          title: "Confirmar aceptación",
          status: "pending",
          primary: true,
          ownerUserId: 7,
          dueDate: "2026-10-02",
          successCriteria: "Aceptación escrita del cliente.",
        },
      ],
      weaknesses: [],
    },
    ...overrides,
  };
}

const commercialStages = [
  [1, "contacto_inicial", "Contacto inicial"],
  [2, "identificacion_oportunidad", "Identificación de oportunidad"],
  [3, "desarrollo", "Desarrollo"],
  [4, "cotizacion", "Cotización"],
  [5, "demostracion", "Demostración"],
  [6, "negociacion", "Negociación"],
  [7, "waiting", "En espera"],
];

describe("Coach deterministic stage readiness", () => {
  it.each(commercialStages)(
    "evaluates complete and blocked readiness for stage %s (%s)",
    (stageId, stageCode, stageName) => {
      const complete = opportunity({
        salesStageId: stageId,
        stageCode,
        stageName,
        currentStage: {
          ...opportunity().currentStage,
          id: stageId,
          code: stageCode,
          name: stageName,
        },
      });
      const ready = buildStageReadiness(complete);
      const blocked = buildStageReadiness({
        ...complete,
        stageQuestions: complete.stageQuestions.map((question) => ({
          ...question,
          answer: null,
        })),
        workspace: {
          ...complete.workspace,
          criteria: complete.workspace.criteria.map((criterion) => ({
            ...criterion,
            status: "blocked",
          })),
        },
      });

      expect(ready.currentStage).toMatchObject({
        id: stageId,
        code: stageCode,
        name: stageName,
      });
      expect(ready.recommendation).toBe("advance");
      expect(blocked.recommendation).toBe("remain");
      expect(blocked.risks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ severity: "critical" }),
        ]),
      );
    },
  );

  it("detects stage preparation questions", () => {
    const preparationQuestions = [
      "¿Qué me falta para avanzar de etapa?",
      "¿Estoy listo para pasar a cotización?",
      "¿Qué preguntas tengo pendientes?",
      "¿Qué bloqueos me impiden avanzar?",
      "Evalúa la preparación de esta oportunidad",
    ];

    preparationQuestions.forEach((question) => {
      expect(isStagePreparationQuestion(question)).toBe(true);
      expect(buildStageReadiness(opportunity())).toEqual(
        expect.objectContaining({
          currentStage: expect.any(Object),
          confirmedProgress: expect.any(Array),
          pendingItems: expect.any(Array),
          risks: expect.any(Array),
          nextStep: expect.any(Object),
          recommendation: expect.any(String),
        }),
      );
    });
    expect(
      isStagePreparationQuestion("¿Cuál es el monto de la oportunidad?"),
    ).toBe(false);
  });

  it("recommends advancing only when required evidence is complete", () => {
    const result = buildStageReadiness(opportunity(), {
      currentUserId: 7,
      now: new Date("2026-09-26T12:00:00Z"),
    });

    expect(result.currentStage.name).toBe("Desarrollo");
    expect(result.confirmedProgress).toHaveLength(2);
    expect(result.pendingItems).toEqual([]);
    expect(result.nextStep).toEqual({
      action: "Confirmar aceptación",
      responsibleUserId: 7,
      targetDate: "2026-10-02",
      successCriteria: "Aceptación escrita del cliente.",
    });
    expect(result.recommendation).toBe("advance");
  });

  it("remains when a required question or criterion is pending", () => {
    const value = opportunity({
      stageQuestions: [
        {
          questionId: 21,
          code: "technical_need",
          prompt: "¿La solución cubre el requerimiento?",
          required: true,
          answer: null,
        },
      ],
      workspace: { criteria: [], actions: [], weaknesses: [] },
    });
    const result = buildStageReadiness(value, {
      currentUserId: 7,
      now: new Date("2026-09-26T12:00:00Z"),
    });

    expect(result.pendingItems).toHaveLength(2);
    expect(result.recommendation).toBe("remain");
    expect(result.nextStep.responsibleUserId).toBe(7);
    expect(result.nextStep.targetDate).toBe("2026-10-03");
  });

  it("advances with caution when criteria are complete but risks remain", () => {
    const value = opportunity({
      workspace: {
        ...opportunity().workspace,
        weaknesses: [
          {
            title: "Fecha de decisión incierta",
            status: "open",
            severity: "high",
            detail: "El cliente no confirmó fecha.",
            mitigation: "Confirmar la fecha con Compras.",
          },
        ],
      },
    });
    const result = buildStageReadiness(value);

    expect(result.risks[0].severity).toBe("high");
    expect(result.recommendation).toBe("advance_with_caution");
  });

  it("advances with caution when only optional questions remain", () => {
    const value = opportunity({
      stageQuestions: [
        ...opportunity().stageQuestions,
        {
          questionId: 22,
          code: "optional_context",
          prompt: "¿Hay contexto adicional?",
          required: false,
          answer: null,
        },
      ],
    });
    const result = buildStageReadiness(value);

    expect(result.pendingItems).toHaveLength(1);
    expect(result.recommendation).toBe("advance_with_caution");
  });

  it("assigns a deterministic target date when the next action has none", () => {
    const value = opportunity({
      workspace: {
        ...opportunity().workspace,
        actions: [
          {
            id: 32,
            title: "Confirmar aceptación",
            status: "pending",
            primary: true,
            ownerUserId: 7,
            successCriteria: "Aceptación escrita del cliente.",
          },
        ],
      },
    });
    const result = buildStageReadiness(value, {
      now: new Date("2026-09-26T12:00:00Z"),
    });

    expect(result.nextStep.targetDate).toBe("2026-10-03");
  });

  it("does not let completed activities satisfy missing criteria", () => {
    const value = opportunity({
      stageQuestions: [],
      workspace: {
        criteria: [{ code: "technical_fit", status: "missing" }],
        actions: [{ id: 40, title: "Enviar correo", status: "done" }],
        weaknesses: [],
      },
    });
    const result = buildStageReadiness(value);

    expect(
      result.confirmedProgress.some((item) => item.title === "Enviar correo"),
    ).toBe(true);
    expect(result.recommendation).toBe("remain");
  });
});
