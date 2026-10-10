import { describe, expect, it } from "vitest";
import {
  listCoachCaseCatalog,
  matchCoachQueryCase,
} from "../src/coach/case-catalog.js";
import { classifyCoachIntent } from "../src/coach/phase-one-engine.js";

describe("Coach case catalog", () => {
  it.each([
    ["Qué riesgos bloquean esta oportunidad?", "COACH-STAGE-RISK-001"],
    ["¿Qué me falta para avanzar de etapa?", "COACH-STAGE-PREPARATION-001"],
    ["¿Qué preguntas debo hacer en Cotización?", "COACH-STAGE-QUESTIONS-001"],
    ["¿Qué actividades están pendientes?", "COACH-ACTIVITY-QUERY-001"],
    ["¿Qué contiene una cotización?", "COACH-QUOTATION-QUERY-001"],
    ["¿Quiénes son los decisores y contactos?", "COACH-CONTACT-QUERY-001"],
    ["Dame un resumen de la cuenta", "COACH-ACCOUNT-QUERY-001"],
  ])("maps the governed case for %s", (question, caseId) => {
    expect(matchCoachQueryCase(question)?.id).toBe(caseId);
  });

  it.each([
    ["¿Qué cuenta es?", "brief_context", "brief_context"],
    ["¿Qué oportunidades debería priorizar?", "seller_coaching", "coaching"],
  ])(
    "maps additional coaching requests",
    (question, policyProcess, interactionMode) => {
      expect(classifyCoachIntent(question)).toMatchObject({
        policyProcess,
        interactionMode,
      });
    },
  );
  it("uses stable IDs and exposes only deterministic catalog metadata", () => {
    expect(listCoachCaseCatalog().map((item) => item.id)).toEqual([
      "COACH-STAGE-RISK-001",
      "COACH-STAGE-PREPARATION-001",
      "COACH-STAGE-QUESTIONS-001",
      "COACH-ACTIVITY-QUERY-001",
      "COACH-QUOTATION-QUERY-001",
      "COACH-CONTACT-QUERY-001",
      "COACH-ACCOUNT-QUERY-001",
    ]);
  });

  it("returns the governed stage-question case through the intent layer", () => {
    expect(
      classifyCoachIntent("¿Qué preguntas debo hacer en Cotización?"),
    ).toMatchObject({
      type: "stage_readiness",
      subtype: "stage_questions",
      interactionMode: "coaching",
      policyProcess: "seller_coaching",
      caseId: "COACH-STAGE-QUESTIONS-001",
      operationRequested: false,
    });
  });

  it.each([
    [
      "¿Cómo puedo mejorar mi desempeño comercial?",
      "seller_coaching",
      "coaching",
    ],
    ["Dame un resumen de la cuenta", "brief_context", "brief_context"],
    ["Actualiza el teléfono de esta cuenta", "operation", "operation"],
    [
      "Dame el historial completo de esta cuenta",
      "default",
      "deep_exploration",
    ],
    ["", "default", "clarification"],
  ])(
    "selects the Coach policy process for %s without replacing its granular type",
    (question, policyProcess, interactionMode) => {
      expect(classifyCoachIntent(question)).toMatchObject({
        policyProcess,
        interactionMode,
      });
    },
  );

  it("keeps the CRM topic separate from a seller-coaching objective", () => {
    expect(
      classifyCoachIntent("¿Cómo priorizo los contactos de esta cuenta?"),
    ).toMatchObject({
      type: "contact_query",
      interactionMode: "coaching",
      policyProcess: "seller_coaching",
    });
  });
});
